import {
  startTraceDatabase,
  traceEnvironment,
} from "../../../packages/traces/test/support.js";
import { traceServices } from "./trace-services.js";
import { PrismaClient } from "@agentcommons/db";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  billingConfigSchema,
  billingUsageSchema,
  ingestEnvelopeSchema,
  type IngestEnvelope,
} from "@agentcommons/core";
import { cleanup } from "../../../scripts/cleanup.js";
import { createRuntime } from "../src/main.js";
import { createApp } from "../src/app.js";
import { environment } from "../src/env.js";
import { requireCaller, type ServiceContext } from "../src/services/context.js";
import { IngestService } from "../src/services/ingest.js";
import { configSchema } from "../../../packages/hook/src/config.js";
import { recordHook } from "../../../packages/hook/src/hook.js";
import { upload } from "../../../packages/hook/src/upload.js";
import { loadState } from "../../../packages/hook/src/state.js";
import {
  provisionOrganization,
  provisionMember,
  testAuthConfiguration,
} from "./support.js";

let db: Awaited<ReturnType<typeof startTraceDatabase>>;
let application: PrismaClient;
let projections: ReturnType<typeof traceServices>;
let runtime: Awaited<ReturnType<typeof createRuntime>>;
let app: Awaited<ReturnType<typeof createApp>>;
let address: string;
const release: Array<() => Promise<unknown>> = [];

function envelope(native = randomUUID()): IngestEnvelope {
  return {
    envelopeVersion: 2,
    hook: { sha256: "a".repeat(64), extensionSha256: null },
    harness: "CLAUDE_CODE",
    harnessSessionId: native,
    installationId: randomUUID(),
    batchId: randomUUID(),
    behavior: "sync",
    start: null,
    nativeEvent: "Stop",
    sentAt: new Date().toISOString(),
    sourcePos: 0,
    cursor: "initial",
    end: null,
    context: {
      cwd: "/billing",
      installation: {
        hostname: "billing",
        osUser: "developer",
        platform: "linux",
        arch: "x64",
      },
      git: null,
      parentHint: null,
    },
    records: [
      {
        key: randomUUID(),
        pos: 0,
        sourceVersion: 0,
        line: JSON.stringify({
          type: "user",
          uuid: randomUUID(),
          message: {
            role: "user",
            content: "Investigate the monthly capture allowance",
          },
        }),
      },
    ],
  };
}
async function organization(slug: string) {
  const value = await provisionOrganization(db, `billing-${slug}`);
  await db.prisma.user.update({
    where: { id: requireCaller(value.owner).userId },
    data: { emailVerified: true },
  });
  return value;
}
function requestHeaders(context: ServiceContext) {
  const result: Record<string, string> = {};
  context.headers.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}
function usage(context: ServiceContext) {
  return runtime.services.billing.usage(context).then((value) => value.result);
}
async function paid(context: ServiceContext, status = "active") {
  const now = new Date();
  await db.prisma.organization.update({
    where: { id: requireCaller(context).organizationId },
    data: { stripeCustomerId: `cus_${randomUUID()}` },
  });
  return db.prisma.subscription.create({
    data: {
      id: randomUUID(),
      referenceId: requireCaller(context).organizationId,
      plan: "pro",
      status,
      stripeSubscriptionId: `sub_${randomUUID()}`,
      stripeCustomerId: `cus_${randomUUID()}`,
      periodStart: new Date(now.getTime() - 60_000),
      periodEnd: new Date(now.getTime() + 40 * 86_400_000),
    },
  });
}
async function capture(context: ServiceContext, input = envelope()) {
  const result = await runtime.services.ingest.execute(context, input);
  await projections.projection.process(
    requireCaller(context).organizationId,
    result.result.sessionId,
  );
  return result;
}
async function ledger(context: ServiceContext) {
  return db.prisma.usageAdmission.count({
    where: { organizationId: requireCaller(context).organizationId },
  });
}

beforeAll(async () => {
  db = await startTraceDatabase();
  release.unshift(() => db.close());
  application = new PrismaClient({ datasourceUrl: db.urls.app });
  release.unshift(() => application.$disconnect());
  projections = traceServices(db, application);
  release.unshift(() => projections.close());
  const env = environment({
    PUBLIC_URL: testAuthConfiguration.publicUrl,
    BETTER_AUTH_SECRET: testAuthConfiguration.secret,
    DATABASE_URL: db.urls.app,
    ...traceEnvironment(db.traceConfig),
    INSTANCE_MODE: "saas",
    FREE_MONTHLY_RECORDS: "2",
    PRO_INCLUDED_RECORDS: "3",
    CAPTURE_CENTS_PER_1000: "5",
    EMBEDDING_CENTS_PER_1000: "10",
    STRIPE_CAPTURE_EVENT_NAME: "capture_records",
    STRIPE_EMBEDDING_EVENT_NAME: "embedded_messages",
    CAL_COM_URL: "https://cal.com/agentcommons/demo",
    LOG_LEVEL: "silent",
    EMBEDDINGS_ENABLED: "false",
  });
  runtime = await createRuntime(env);
  release.unshift(() => runtime.close());
  app = await createApp({ env, services: runtime.services, static: false });
  release.unshift(() => app.close());
  address = await app.listen({ host: "127.0.0.1", port: 0 });
}, 120_000);
afterAll(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  expect(await cleanup(release.splice(0))).toEqual([]);
});

// @req R-SAAS-03
it("serializes concurrent record admission at the exact org cap and never charges retries or moves another org’s usage", async () => {
  const org = await organization("concurrent");
  const inputs = [envelope(), envelope(), envelope()];
  const results = await Promise.allSettled(
    inputs.map((input) => capture(org.context, input)),
  );
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(2);
  const rejected = results.filter((result) => result.status === "rejected");
  expect(rejected).toHaveLength(1);
  expect(rejected[0]).toMatchObject({
    reason: {
      statusCode: 402,
      code: "USAGE_LIMIT_REACHED",
      detail: { plan: "free", included_records: 2 },
    },
  });
  expect(await ledger(org.context)).toBe(2);
  expect(
    await db.prisma.traceSessionControl.count({
      where: { organizationId: requireCaller(org.context).organizationId },
    }),
  ).toBe(2);
  const accepted = z
    .number()
    .parse(results.findIndex((result) => result.status === "fulfilled"));
  const original = ingestEnvelopeSchema.parse(inputs[accepted]);
  await capture(org.context, original);
  await capture(org.context, {
    ...original,
    batchId: randomUUID(),
    sourcePos: 1,
    records: [
      {
        ...z
          .object({
            key: z.string(),
            pos: z.number(),
            sourceVersion: z.number(),
            line: z.string(),
          })
          .parse(original.records[0]),
        pos: 1,
      },
    ],
  });
  expect(await usage(org.owner)).toMatchObject({
    records_used: 2,
    remaining: 0,
  });
  const other = await organization("other");
  await capture(other.context, original);
  expect(await ledger(other.context)).toBe(1);
  expect(await ledger(org.context)).toBe(2);
});

// @req R-SAAS-03
it("rolls admission back with invalid records, unpaired results and a failed mandatory audit", async () => {
  const org = await organization("rollback");
  const invalid = envelope();
  invalid.records = [
    { key: randomUUID(), pos: 0, sourceVersion: 0, line: "invalid JSON" },
  ];
  await expect(capture(org.context, invalid)).rejects.toMatchObject({
    statusCode: 422,
  });
  const unpaired = envelope();
  unpaired.records = [
    {
      key: randomUUID(),
      pos: 0,
      sourceVersion: 0,
      line: JSON.stringify({
        type: "user",
        uuid: randomUUID(),
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "never-observed",
              content: "failed result",
            },
          ],
        },
      }),
    },
  ];
  await expect(capture(org.context, unpaired)).rejects.toMatchObject({
    statusCode: 422,
  });
  const spy = vi
    .spyOn(runtime.services.audit, "write")
    .mockRejectedValueOnce(new Error("Mandatory audit write failed"));
  try {
    await expect(capture(org.context)).rejects.toMatchObject({
      statusCode: 500,
    });
  } finally {
    spy.mockRestore();
  }
  expect(await ledger(org.context)).toBe(0);
  expect(
    await db.prisma.traceSessionControl.count({
      where: { organizationId: requireCaller(org.context).organizationId },
    }),
  ).toBe(0);
  expect(
    await db.prisma.installation.count({
      where: { organizationId: requireCaller(org.context).organizationId },
    }),
  ).toBe(0);
  await capture(org.context);
  expect(await ledger(org.context)).toBe(1);
});

// @req R-SAAS-03
it("retains append-only record admissions after purge and does not recharge pre-SaaS raw identities", async () => {
  const org = await organization("retention");
  const input = envelope();
  const customer = new IngestService({
    ...db,
    traces: projections.jobs,
    billing: {
      mode: "customer",
      freeMonthlyRecords: 0,
      proIncludedRecords: 1,
      calComUrl: null,
      captureCentsPer1000: null,
      embeddingCentsPer1000: null,
      captureEventName: null,
      embeddingEventName: null,
    },
  });
  await customer.execute(org.context, input);
  expect(await ledger(org.context)).toBe(0);
  await capture(org.context, { ...input, batchId: randomUUID() });
  expect(await ledger(org.context)).toBe(0);
  const first = await capture(org.context);
  await capture(org.context);
  await runtime.services.admin.purge(org.owner, {
    session_id: first.result.sessionId,
    reason: "Validate retention-independent usage",
  });
  expect(await usage(org.owner)).toMatchObject({
    records_used: 2,
    remaining: 0,
  });
  await expect(capture(org.context)).rejects.toMatchObject({ statusCode: 402 });
  await capture(org.context, { ...input, batchId: randomUUID() });
  const identity = requireCaller(org.context).organizationId;
  await expect(
    application.usageAdmission.deleteMany({
      where: { organizationId: identity },
    }),
  ).rejects.toThrow();
  await expect(
    application.usageAdmission.updateMany({
      where: { organizationId: identity },
      data: { admittedAt: new Date(0) },
    }),
  ).rejects.toThrow();
  expect(await ledger(org.context)).toBe(2);
});

// @req R-SAAS-03
it.each(["customer", "public"] as const)(
  "does not meter %s deployments even when the configured free allowance is zero",
  async (mode) => {
    const org = await organization(`unmetered-${mode}`);
    const service = new IngestService({
      ...db,
      traces: projections.jobs,
      billing: {
        mode,
        freeMonthlyRecords: 0,
        proIncludedRecords: 1,
        calComUrl: null,
        captureCentsPer1000: null,
        embeddingCentsPer1000: null,
        captureEventName: null,
        embeddingEventName: null,
      },
    });
    for (let index = 0; index < 3; index++)
      await service.execute(org.context, envelope());
    expect(await ledger(org.context)).toBe(0);
    expect(
      await db.prisma.traceSessionControl.count({
        where: { organizationId: requireCaller(org.context).organizationId },
      }),
    ).toBe(3);
  },
);

// @req R-SAAS-03
it("resets only the UTC-month interval while lifetime identities stay charged once", async () => {
  const org = await organization("month");
  const input = envelope();
  await capture(org.context, input);
  await capture(org.context);
  const current = await usage(org.owner);
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    vi.setSystemTime(new Date(current.period_end));
    expect(await usage(org.owner)).toMatchObject({
      records_used: 0,
      remaining: 2,
      period_start: current.period_end,
    });
    await capture(org.context, {
      ...input,
      batchId: randomUUID(),
      sentAt: new Date().toISOString(),
    });
    expect(await ledger(org.context)).toBe(2);
    await capture(org.context);
    await capture(org.context);
    await expect(capture(org.context)).rejects.toMatchObject({
      statusCode: 402,
    });
    expect(await usage(org.owner)).toMatchObject({
      records_used: 2,
      remaining: 0,
    });
    expect(await ledger(org.context)).toBe(4);
  } finally {
    vi.useRealTimers();
  }
});

// @req R-SAAS-03 @req R-SAAS-05
it("uses only current active paid native state, preserving usage through upgrades, cancellation and downgrade", async () => {
  const org = await organization("entitlement");
  const input = envelope();
  await capture(org.context, input);
  await capture(org.context);
  // Native signed-webhook behavior is tested separately; these are persisted state inputs to quota admission.
  const subscription = await paid(org.context, "incomplete");
  for (const status of [
    "incomplete",
    "trialing",
    "past_due",
    "unpaid",
    "canceled",
  ]) {
    await db.prisma.subscription.update({
      where: { id: subscription.id },
      data: { status },
    });
    expect(await usage(org.owner)).toMatchObject({
      plan: "free",
      records_used: 2,
      included_records: 2,
    });
  }
  await db.prisma.subscription.update({
    where: { id: subscription.id },
    data: { status: "active", cancelAtPeriodEnd: true },
  });
  expect(await usage(org.owner)).toMatchObject({
    plan: "pro",
    records_used: 0,
    included_records: 3,
    remaining: 3,
  });
  for (let index = 0; index < 4; index++) await capture(org.context);
  expect(await usage(org.owner)).toMatchObject({
    plan: "pro",
    records_used: 4,
    included_records: 3,
    remaining: 0,
    overage_records: 1,
    metering_pending: 4,
    estimated_capture_usd: 0.00005,
  });
  const meters = await db.prisma.billingMeterEvent.findMany({
    where: { organizationId: requireCaller(org.context).organizationId },
  });
  expect(meters).toHaveLength(4);
  expect(
    meters.every(
      (row) =>
        row.kind === "capture" &&
        row.quantity === 1 &&
        row.eventName === "capture_records",
    ),
  ).toBe(true);
  await db.prisma.subscription.update({
    where: { id: subscription.id },
    data: { periodEnd: new Date(Date.now() - 1) },
  });
  expect(await usage(org.owner)).toMatchObject({
    plan: "free",
    records_used: 2,
    remaining: 0,
  });
  await capture(org.context, { ...input, batchId: randomUUID() });
  await expect(capture(org.context)).rejects.toMatchObject({ statusCode: 402 });
  expect(await ledger(org.context)).toBe(6);
});

// @req R-SAAS-06
it("serves shared public pricing without tenant data, scopes member usage, and rejects non-owner/key finance or client-selected references", async () => {
  const org = await organization("api");
  const member = await provisionMember(
    db,
    org.owner,
    "billing-member@example.com",
  );
  await db.prisma.user.update({
    where: { id: requireCaller(member.owner).userId },
    data: { emailVerified: true },
  });
  await capture(org.context);
  const publicResponse = await app.inject({
    method: "GET",
    url: "/api/v1/billing/config",
  });
  expect(publicResponse.statusCode).toBe(200);
  const config = billingConfigSchema.parse(publicResponse.json());
  expect(config).toEqual({
    mode: "saas",
    enabled: true,
    plans: {
      free: { monthly_records: 2 },
      pro: {
        included_records: 3,
        monthly_price_usd: 100,
        capture_usd_per_1000: 0.05,
      },
      embeddings: { monthly_price_usd: 50, messages_usd_per_1000: 0.1 },
    },
    checkout_enabled: false,
    cal_com_url: "https://cal.com/agentcommons/demo",
  });
  expect(publicResponse.body).not.toContain(
    requireCaller(org.owner).organizationId,
  );
  expect(publicResponse.body).not.toContain(testAuthConfiguration.secret);
  expect(
    (await app.inject({ method: "GET", url: "/api/v1/billing" })).statusCode,
  ).toBe(401);
  for (const [actor, canManage] of [
    [org.owner, true],
    [org.context, false],
    [member.owner, false],
  ] as const) {
    const headers = requestHeaders(actor);
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/billing",
      headers,
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(billingUsageSchema.parse(response.json())).toMatchObject({
      records_used: 1,
      included_records: 2,
      can_manage: canManage,
      checkout_enabled: false,
    });
    for (const endpoint of ["checkout", "portal"]) {
      const result = await app.inject({
        method: "POST",
        url: `/api/v1/billing/${endpoint}`,
        headers: { ...headers, origin: testAuthConfiguration.publicUrl },
        payload: endpoint === "checkout" ? { plan: "pro" } : {},
      });
      expect(result.statusCode, result.body).toBe(canManage ? 503 : 403);
    }
  }
  const forged = await app.inject({
    method: "POST",
    url: "/api/v1/billing/checkout",
    headers: {
      ...requestHeaders(org.owner),
      origin: testAuthConfiguration.publicUrl,
    },
    payload: {
      referenceId: "another-organization",
      plan: "enterprise",
      returnUrl: "https://invalid.example",
    },
  });
  expect(forged.statusCode).toBe(400);
  const other = await organization("api-other");
  expect(await usage(other.owner)).toMatchObject({ records_used: 0 });
});

// @req R-SAAS-04
it.each(["upgrade", "month reset"] as const)(
  "retains a real HTTP 402 pending batch and cursor until %s permits exact-batch recovery",
  async (recovery) => {
    const org = await organization(`shim-${recovery.replace(" ", "-")}`);
    const existing = await capture(org.context);
    await capture(org.context);
    const directory = await mkdtemp(join(tmpdir(), "agentcommons-quota-shim-"));
    try {
      const transcript = join(directory, "session.jsonl");
      await writeFile(
        transcript,
        `${JSON.stringify({ type: "user", uuid: randomUUID(), message: { content: "Retain this upload until quota is available" } })}\n`,
      );
      const config = configSchema.parse({
        server: address,
        key: org.key,
        installationId: randomUUID(),
        node: process.execPath,
      });
      const native = randomUUID();
      const path = recordHook(
        directory,
        "/nonexistent-quota-hook.js",
        config,
        "claude",
        {
          session_id: native,
          transcript_path: transcript,
          cwd: directory,
          hook_event_name: "Stop",
        },
        "quota-launch",
      );
      if (!path) throw new Error("Expected a durable upload intent");
      const sent: IngestEnvelope[] = [];
      const network: typeof fetch = async (url, options) => {
        if (options?.method === "POST" && typeof options.body === "string")
          sent.push(ingestEnvelopeSchema.parse(JSON.parse(options.body)));
        return fetch(url, options);
      };
      await upload(directory, "/nonexistent-quota-hook.js", path, config, {
        fetch: network,
        sweep: false,
      });
      const blocked = loadState(path);
      expect(blocked.suspended).toBeNull();
      expect(blocked.ackedCursor).toEqual({ kind: "jsonl", offset: 0 });
      if (!blocked.pending)
        throw new Error("Quota must retain the pending batch");
      const bytes = await readFile(blocked.pending.file, "utf8");
      const pendingId = ingestEnvelopeSchema.parse(JSON.parse(bytes)).batchId;
      await upload(directory, "/nonexistent-quota-hook.js", path, config, {
        fetch: network,
        sweep: false,
      });
      expect(await readFile(blocked.pending.file, "utf8")).toBe(bytes);
      expect(sent.map((input) => input.batchId)).toEqual([
        pendingId,
        pendingId,
      ]);
      const read = await app.inject({
        method: "GET",
        url: `/api/v1/sessions/${existing.result.sessionId}`,
        headers: { authorization: `Bearer ${org.key}` },
      });
      expect(read.statusCode, read.body).toBe(200);
      if (recovery === "upgrade") await paid(org.context);
      else {
        const prior = await usage(org.owner);
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date(prior.period_end));
      }
      await upload(directory, "/nonexistent-quota-hook.js", path, config, {
        fetch: network,
        sweep: false,
      });
      const ready = loadState(path);
      expect(ready.pending).toBeNull();
      expect(ready.ackedCursor).toEqual({
        kind: "jsonl",
        offset: Buffer.byteLength(await readFile(transcript)),
      });
      expect(sent[2]?.batchId).toBe(pendingId);
      expect(await ledger(org.context)).toBe(3);
      expect(
        await db.prisma.traceSessionControl.count({
          where: {
            organizationId: requireCaller(org.context).organizationId,
            harnessSessionId: native,
          },
        }),
      ).toBe(1);
    } finally {
      vi.useRealTimers();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
