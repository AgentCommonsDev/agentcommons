import { startTraceDatabase } from "../../../packages/traces/test/support.js";
import { traceServices } from "./trace-services.js";
import { createTraceClient } from "@agentcommons/traces";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  errorSchema,
  organizationEmbeddingsOutputSchema,
  type IngestEnvelope,
} from "@agentcommons/core";
import { provisionOrganization, provisionMember, releaser } from "./support.js";
import { mcpClient, startApp, type StartedApp } from "./app.js";
import { testEnvelope, textRecord } from "./envelopes.js";
import { EmbeddingService } from "../src/embeddings/service.js";
import { FakeEmbeddingProvider } from "../src/embeddings/provider.js";

let db: Awaited<ReturnType<typeof startTraceDatabase>>;
let first: Awaited<ReturnType<typeof provisionOrganization>>;
let second: typeof first;
let member: Awaited<ReturnType<typeof provisionMember>>;
let projections: ReturnType<typeof traceServices>;
let runtime: StartedApp["runtime"];
let address: string;
const { defer, release } = releaser();
const embeddingsEnvironment = (enabled: boolean) => ({
  EMBEDDINGS_ENABLED: String(enabled),
  EMBEDDINGS_PROVIDER: "fake",
});
function envelope(text: string): IngestEnvelope {
  return testEnvelope({
    sourcePos: 1,
    context: { installation: { hostname: "embeddings-test", osUser: "user" } },
    records: [textRecord(0, text)],
  });
}
async function vectorCount(organizationId?: string) {
  const native = createTraceClient(db.traceConfig);
  try {
    const response = await native.query({
      query:
        "SELECT count() AS count FROM session_embeddings FINAL WHERE NOT deleted" +
        (organizationId ? " AND organization_id={organizationId:String}" : ""),
      query_params: organizationId ? { organizationId } : {},
      format: "JSONEachRow",
    });
    const rows = z
      .array(z.object({ count: z.coerce.bigint() }))
      .parse(await response.json());
    return rows[0]?.count ?? 0n;
  } finally {
    await native.close();
  }
}
async function setting(account = first) {
  const response = await fetch(`${address}/api/v1/organization/embeddings`, {
    headers: { authorization: `Bearer ${account.key}` },
  });
  expect(response.status).toBe(200);
  return organizationEmbeddingsOutputSchema.parse(await response.json());
}
async function change(enabled: boolean, account = first) {
  return fetch(`${address}/api/v1/organization/embeddings`, {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${account.key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      enabled,
      reason: "Organization embedding integration",
    }),
  });
}
beforeAll(async () => {
  db = await startTraceDatabase();
  defer(() => db.close());
  projections = traceServices(db);
  defer(() => projections.close());
  first = await provisionOrganization(db, "embedding-control-first");
  second = await provisionOrganization(db, "embedding-control-second");
  member = await provisionMember(
    db,
    first.owner,
    "embedding-control-member@example.com",
  );
  const started = await startApp(db, embeddingsEnvironment(true), {
    listen: true,
  });
  defer(() => started.close());
  ({ runtime, address } = started);
});
afterAll(release);

// @req R-EMB-06
it("defaults off, enforces admin authority, and durably catches up only the opted-in organization's retained corpus", async () => {
  const dispatch = vi.spyOn(FakeEmbeddingProvider.prototype, "embed");
  try {
    expect(await setting()).toMatchObject({
      enabled: false,
      available: true,
      effective: false,
      provider: "fake",
      sessions_total: 0,
      last_attempt: null,
    });
    expect(await setting(member)).toMatchObject({ enabled: false });
    expect((await change(true, member)).status).toBe(403);
    const a = await projections.publish(
      first.context,
      envelope("blue orchard apple"),
    );
    const b = await projections.publish(
      first.context,
      envelope("blue orchard pear"),
    );
    await projections.publish(second.context, envelope("blue orchard plum"));
    expect(dispatch).not.toHaveBeenCalled();
    expect((await change(true)).status).toBe(200);
    const queued = await db.prisma.$queryRaw<
      { count: bigint }[]
    >`SELECT count(*) count FROM pgboss.job WHERE name='organization-embedding-catchup' AND data->>'organizationId'=${z.string().parse(first.context.caller?.organizationId)}`;
    expect(queued[0]?.count).toBe(1n);
    expect((await change(true, second)).status).toBe(200);
    expect((await change(false, second)).status).toBe(200);
    // The worker runs only for this catch-up; later tests drive the provider themselves.
    await runtime.jobs.start();
    try {
      await expect
        .poll(async () => (await setting()).sessions_indexed, {
          timeout: 20_000,
        })
        .toBe(2);
    } finally {
      await runtime.jobs.stop();
    }
    expect(await setting(second)).toMatchObject({
      effective: false,
      sessions_total: 1,
      sessions_indexed: 0,
    });
    expect(
      await db.prisma.embeddingAttempt.count({
        where: {
          organizationId: z
            .string()
            .parse(second.context.caller?.organizationId),
        },
      }),
    ).toBe(0);
    const similar = await runtime.services.similar?.execute(
      first.context,
      a.result.sessionId,
      {},
    );
    expect(
      similar?.result.sessions.map((session) => session.session_id),
    ).toContain(b.result.sessionId);
    expect(
      z.object({ features: z.array(z.string()) }).parse(
        await (
          await fetch(`${address}/auth/config`, {
            headers: { authorization: `Bearer ${first.key}` },
          })
        ).json(),
      ).features,
    ).toEqual(["similar_sessions"]);
    expect(
      z.object({ features: z.array(z.string()) }).parse(
        await (
          await fetch(`${address}/auth/config`, {
            headers: { authorization: `Bearer ${second.key}` },
          })
        ).json(),
      ).features,
    ).toEqual([]);
    expect(
      z
        .object({ features: z.array(z.string()) })
        .parse(await (await fetch(`${address}/auth/config`)).json()).features,
    ).toEqual([]);
    await runtime.services.admin.setVisibility(first.context, {
      session_id: b.result.sessionId,
      visibility: "PRIVATE",
      reason: "Check caller-visible embedding progress",
    });
    const memberView = await setting(member);
    expect(memberView).toMatchObject({
      effective: true,
      sessions_total: 1,
      sessions_indexed: 1,
    });
    expect(await setting()).toMatchObject({
      sessions_total: 2,
      sessions_indexed: 2,
    });
  } finally {
    dispatch.mockRestore();
  }
}, 60_000);

// @req R-EMB-06
it("disables retained vectors and SQL discovery immediately while REST and MCP search remain lexical with unchanged tools", async () => {
  const client = await mcpClient(address, first.key, {
    name: "organization-embedding-test",
  });
  const dispatch = vi.spyOn(FakeEmbeddingProvider.prototype, "embed");
  try {
    const catalog = (await client.listTools()).tools;
    const before = await vectorCount();
    expect((await change(false)).status).toBe(200);
    expect(await setting()).toMatchObject({
      enabled: false,
      effective: false,
      sessions_indexed: 2,
    });
    const call = await client.callTool({
      name: "search",
      arguments: { query: "orchard" },
    });
    expect(call.isError).not.toBe(true);
    expect(dispatch).not.toHaveBeenCalled();
    expect((await client.listTools()).tools).toEqual(catalog);
    const discovered = await runtime.services.query.execute(first.context, {
      sql: "SELECT function_name FROM schema_functions WHERE function_name='similar_sessions'",
    });
    expect(discovered.result.rows).toEqual([]);
    const denied = await client.callTool({
      name: "sql",
      arguments: {
        sql: "SELECT * FROM similar_sessions(source='00000000-0000-0000-0000-000000000000',max_rows=5)",
      },
    });
    expect(denied.isError).toBe(true);
    // The agent learns which capability needs embeddings, why they are off and who can
    // change that, instead of a generic "unavailable view" rejection.
    const deniedError = errorSchema.parse(
      JSON.parse(
        z
          .array(z.object({ type: z.literal("text"), text: z.string() }))
          .parse(denied.content)[0]?.text ?? "",
      ),
    );
    expect(deniedError).toMatchObject({
      code: "EMBEDDINGS_DISABLED",
      message:
        "similar_sessions needs embeddings, which are turned off for this organization. An organization admin can turn them on under Settings. Use search_messages(q='words') for keyword search.",
      detail: { position: 15 },
    });
    for (const sql of [
      "SELECT count() FROM message_chunks",
      "SELECT cosineDistance([1],[1])",
    ])
      await expect(
        runtime.services.query.execute(first.context, { sql }),
      ).rejects.toMatchObject({
        statusCode: 400,
        code: "EMBEDDINGS_DISABLED",
        message: expect.stringContaining(
          "turned off for this organization",
        ) as string,
      });
    const id = z.string().parse(
      (
        await db.prisma.traceSessionControl.findFirst({
          where: {
            organizationId: z
              .string()
              .parse(first.context.caller?.organizationId),
          },
        })
      )?.id,
    );
    const similar = await fetch(`${address}/api/v1/sessions/${id}/similar`, {
      headers: { authorization: `Bearer ${first.key}` },
    });
    expect(similar.status).toBe(404);
    expect(errorSchema.parse(await similar.json())).toEqual({
      code: "EMBEDDINGS_DISABLED",
      message:
        "Similar sessions needs embeddings, which are turned off for this organization. An organization admin can turn them on under Settings.",
    });
    expect(await vectorCount()).toBe(before);
  } finally {
    dispatch.mockRestore();
    await client.close();
  }
});

// @req R-EMB-06
it("discards an in-flight result across disable and re-enable while retaining its reserved provider cost", async () => {
  const account = await provisionOrganization(db, "embedding-control-flight");
  const organizationId = z
    .string()
    .parse(account.context.caller?.organizationId);
  const received = await projections.publish(
    account.context,
    envelope("in-flight unique orchard"),
  );
  expect((await change(true, account)).status).toBe(200);
  let started: () => void = () => {};
  const began = new Promise<void>((resolve) => {
    started = resolve;
  });
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const provider = new FakeEmbeddingProvider();
  const native = provider.embed.bind(provider);
  const dispatch = vi
    .spyOn(provider, "embed")
    .mockImplementation(async (inputs) => {
      started();
      await gate;
      return native(inputs);
    });
  const service = new EmbeddingService({
    ...db,
    provider,
    dailyTokenBudget: 5_000_000,
  });
  const work = service.process({
    organizationId,
    sessionId: received.result.sessionId,
  });
  try {
    await began;
    expect((await change(false, account)).status).toBe(200);
    expect((await change(true, account)).status).toBe(200);
  } finally {
    release();
  }
  expect((await work).complete).toBe(false);
  expect(dispatch).toHaveBeenCalledTimes(1);
  expect(await vectorCount(organizationId)).toBe(0n);
  const budget = await db.prisma.embeddingBudget.findFirst({
    where: { organizationId },
  });
  expect(budget?.reservedTokens).toBeGreaterThan(0n);
  expect(budget?.actualTokens).toBeGreaterThan(0n);
  dispatch.mockRestore();
  expect(
    (
      await service.process({
        organizationId,
        sessionId: received.result.sessionId,
      })
    ).complete,
  ).toBe(true);
});

// @req R-EMB-06
it("keeps the global operator kill switch authoritative and records failed enable attempts", async () => {
  const disabled = await startApp(db, embeddingsEnvironment(false));
  const off = disabled.runtime;
  try {
    expect(
      (await off.services.organizationEmbeddings.get(first.context)).result,
    ).toMatchObject({ available: false, effective: false, provider: null });
    await expect(
      off.services.organizationEmbeddings.set(first.context, {
        enabled: true,
        reason: "Unavailable provider",
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "EMBEDDINGS_UNAVAILABLE",
      audited: true,
    });
    // Without an operator provider the SQL surface says so, even for an opted-in organization.
    await expect(
      off.services.query.execute(first.context, {
        sql: "SELECT * FROM similar_sessions(source='00000000-0000-0000-0000-000000000000',max_rows=5)",
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "EMBEDDINGS_DISABLED",
      message:
        "similar_sessions needs embeddings, and this instance has no embedding provider configured. The instance operator has to configure one. Use search_messages(q='words') for keyword search.",
    });
    expect(off.services.similar).toBeUndefined();
    expect(
      await db.prisma.auditEvent.count({
        where: {
          organizationId: z
            .string()
            .parse(first.context.caller?.organizationId),
          action: "organization.embeddings.update",
          statusCode: 409,
        },
      }),
    ).toBe(1);
  } finally {
    await disabled.close();
  }
});

// @req R-EMB-06 @req R-AUD-01
it("rolls back the setting and durable catch-up job when its mutation audit cannot be stored", async () => {
  const account = await provisionOrganization(db, "embedding-control-audit");
  const organizationId = z
    .string()
    .parse(account.context.caller?.organizationId);
  const audit = runtime.services.audit;
  const native = audit.write.bind(audit);
  const fault = vi
    .spyOn(audit, "write")
    .mockImplementation(async (context, operation, tx) => {
      if (
        context.caller?.organizationId === organizationId &&
        operation.action === "organization.embeddings.update" &&
        operation.statusCode === undefined
      )
        throw new Error("Injected unavailable audit storage");
      return native(context, operation, tx);
    });
  try {
    expect((await change(true, account)).status).toBe(500);
  } finally {
    fault.mockRestore();
  }
  expect(
    await db.prisma.organizationSettings.findUnique({
      where: { organizationId },
    }),
  ).toBeNull();
  const queued = await db.prisma.$queryRaw<
    { count: bigint }[]
  >`SELECT count(*) count FROM pgboss.job WHERE name='organization-embedding-catchup' AND data->>'organizationId'=${organizationId}`;
  expect(queued[0]?.count).toBe(0n);
  expect((await change(true, account)).status).toBe(200);
  expect(await setting(account)).toMatchObject({
    enabled: true,
    effective: true,
  });
});
