import { cleanup as cleanupAll } from "../../../scripts/cleanup.js";
import { setTimeout as delay } from "node:timers/promises";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { JOB_QUEUES, Prisma } from "@agentcommons/db";
import { startTraceDatabase } from "../../../packages/traces/test/support.js";
import { traceServices } from "./trace-services.js";
import { requireCaller } from "../src/services/context.js";
import type { JobService } from "../src/services/jobs.js";
import { AdminService } from "../src/services/admin.js";
import { PolicyService } from "../src/services/policies.js";
import { CursorCodec } from "../src/services/cursor.js";
import { provisionOrganization, provisionMember } from "./support.js";
import { wireValue } from "../src/services/read-budget.js";
import type { Harness, IngestEnvelope } from "@agentcommons/core";
import type { ServiceContext } from "../src/services/context.js";

let database: Awaited<ReturnType<typeof startTraceDatabase>>;
let first: Awaited<ReturnType<typeof provisionOrganization>>;
let other: Awaited<ReturnType<typeof provisionOrganization>>;
let jobs: JobService;
let admin: AdminService;
let services: ReturnType<typeof traceServices>;
let policies: PolicyService;
let workerErrors: Error[];
function request(
  records: unknown[],
  harness: Harness = "CLAUDE_CODE",
): IngestEnvelope {
  return {
    envelopeVersion: 2,
    harness,
    harnessSessionId: uuidv7(),
    behavior: "sync",
    start: null,
    nativeEvent: "Stop",
    batchId: uuidv7(),
    installationId: uuidv7(),
    sentAt: new Date().toISOString(),
    context: {
      cwd: "/repo/private-phrase",
      installation: {
        hostname: "test",
        osUser: "test",
        platform: "linux",
        arch: "x64",
      },
      git: {
        root: "/repo",
        remoteUrl: "git@github.com:rek7/agentcommons.git",
        branch: "private-phrase",
        head: "abc",
      },
      parentHint: null,
    },
    records: records.map((payload, pos) => ({
      pos,
      sourceVersion: 0,
      key: String(pos),
      line: JSON.stringify(payload),
    })),
    sourcePos: records.length,
    cursor: String(records.length),
    end: null,
  };
}
async function scope(sessionId: string) {
  const control = await database.prisma.traceSessionControl.findFirstOrThrow({
    where: { id: sessionId },
  });
  return services.scope(control.organizationId, sessionId);
}
async function rawRecords(sessionId: string) {
  const current = await scope(sessionId);
  return services.raw(current.organizationId, sessionId);
}
async function publishedMessages(sessionId: string) {
  const current = await scope(sessionId);
  return services.messages(current.organizationId, sessionId);
}
async function header(sessionId: string) {
  const current = await scope(sessionId);
  return services.header(current.organizationId, sessionId);
}
async function files(sessionId: string) {
  return (
    await database.traces.projectionManifest(await scope(sessionId), "files", {
      after: null,
      limit: 1000,
    })
  ).items;
}
const textRecord = (text: string) => ({
  type: "user",
  message: { content: [{ type: "text", text }] },
});
async function waitFor(
  context: ServiceContext,
  id: string,
  state: "completed" | "failed",
) {
  const deadline = Date.now() + 20_000;
  for (;;) {
    const progress = (await jobs.progress(context, id)).result;
    if (progress.state === state) return progress;
    if (Date.now() >= deadline)
      throw new Error(
        `Rescan remained ${progress.state}: ${progress.error ?? "no worker error"}`,
      );
    await delay(100);
  }
}
const release: Array<() => Promise<unknown>> = [];
beforeAll(async () => {
  database = await startTraceDatabase();
  release.unshift(() => database.close());
  first = await provisionOrganization(database, "jobs-first");
  other = await provisionOrganization(database, "jobs-other");
  const cursors = new CursorCodec("jobs-cursor-secret");
  services = traceServices(database, undefined, { auditRetentionDays: 30 });
  jobs = services.jobs;
  workerErrors = services.errors;
  release.unshift(() => jobs.stop());
  admin = new AdminService({
    ...database,
    readers: database.traceReaders,
    cursors,
    jobs,
  });
  policies = new PolicyService({
    ...database,
    cursors,
    cache: database.policies,
  });
  await jobs.start();
});
afterAll(async () => {
  expect(await cleanupAll(release.splice(0))).toEqual([]);
});

describe("native pg-boss rescan and maintenance", () => {
  // @req R-ING-03 @req R-ING-04 @req R-ING-09 @req R-RED-06 @req R-ORG-06
  it("preserves session, record, owner, visibility, tombstone and explicit parent identity when a new policy matches native IDs", async () => {
    const org = await provisionOrganization(database, "identity-policy-review");
    const member = await provisionMember(
      database,
      org.owner,
      "identity-review-member@example.com",
    );
    const body = request([textRecord("Identity survives policy changes")]);
    body.harnessSessionId = `identity-policy-${uuidv7()}`;
    body.records = body.records.map((row) => ({
      ...row,
      key: `identity-policy-key-${uuidv7()}`,
    }));
    const parent = await services.publish(org.context, body);
    await database.prisma.traceSessionControl.updateMany({
      where: { id: parent.result.sessionId },
      data: { visibility: "PRIVATE" },
    });
    const childBody = request([textRecord("Explicit child")]);
    childBody.context.parentHint = {
      relation: "SPAWNED",
      harnessSessionId: body.harnessSessionId,
    };
    const child = await services.publish(org.context, childBody);
    const laterParentBody = request([]);
    laterParentBody.harnessSessionId = `identity-policy-later-${uuidv7()}`;
    const pendingBody = request([]);
    pendingBody.context.parentHint = {
      relation: "SPAWNED",
      harnessSessionId: laterParentBody.harnessSessionId,
    };
    const pending = await services.publish(org.context, pendingBody);
    const foreign = await services.publish(other.context, {
      ...body,
      batchId: uuidv7(),
    });
    await policies.save(org.owner, null, {
      name: "native-identity",
      kind: "REGEX",
      pattern: "identity-policy-",
      flags: "g",
      enabled: true,
    });
    expect((await services.publish(org.context, body)).result).toEqual({
      ...parent.result,
      publication: "published",
    });
    expect(
      (await services.publish(org.context, { ...body, batchId: uuidv7() }))
        .result,
    ).toMatchObject({
      sessionId: parent.result.sessionId,
      accepted: 0,
      duplicates: 1,
    });
    await services.publish(org.context, { ...childBody, batchId: uuidv7() });
    const scan = await admin.rescan(org.owner, {
      reason: "Native identifier policy review",
    });
    await waitFor(org.owner, scan.result.job_id, "completed");
    const stored = await database.prisma.traceSessionControl.findFirstOrThrow({
      where: { id: parent.result.sessionId },
    });
    expect(stored.visibility).toBe("PRIVATE");
    expect(stored.harnessSessionId).toMatch(/^redacted-[a-f0-9]{64}$/);
    expect(
      JSON.stringify(wireValue(await rawRecords(stored.id))),
    ).not.toContain("identity-policy-");
    expect((await services.publish(org.context, body)).result).toEqual({
      ...parent.result,
      publication: "published",
    });
    const appended = await services.publish(org.context, {
      ...body,
      batchId: uuidv7(),
      sourcePos: 10,
      records: [
        ...body.records,
        {
          pos: 10,
          sourceVersion: 0,
          key: "new-key",
          line: JSON.stringify(textRecord("Later append")),
        },
      ],
    });
    expect(appended.result).toMatchObject({
      sessionId: stored.id,
      accepted: 1,
      duplicates: 1,
    });
    await expect(
      services.publish(member.context, { ...body, batchId: uuidv7() }),
    ).rejects.toMatchObject({ code: "SESSION_OWNED" });
    await services.publish(org.context, { ...childBody, batchId: uuidv7() });
    expect(
      (
        await database.prisma.traceSessionControl.findFirstOrThrow({
          where: { id: child.result.sessionId },
        })
      ).parentSessionId,
    ).toBe(stored.id);
    const laterParent = await services.publish(org.context, laterParentBody);
    expect(
      (
        await database.prisma.traceSessionControl.findFirstOrThrow({
          where: { id: pending.result.sessionId },
        })
      ).parentSessionId,
    ).toBe(laterParent.result.sessionId);
    expect(
      (
        await database.prisma.traceSessionControl.findFirstOrThrow({
          where: { id: foreign.result.sessionId },
        })
      ).harnessSessionId,
    ).toBe(body.harnessSessionId);
    await admin.purge(org.owner, {
      session_id: stored.id,
      reason: "Identity tombstone review",
    });
    await expect(
      services.publish(org.context, { ...body, batchId: uuidv7() }),
    ).rejects.toMatchObject({ code: "SESSION_PURGED" });
    expect(
      await database.prisma.traceSessionControl.count({
        where: { organizationId: stored.organizationId, userId: stored.userId },
      }),
    ).toBe(4);
  });

  // @req R-RED-06 @req R-ORG-09 @req R-AUD-01
  it("atomically queues a scope-bound scan and rebuilds redacted raw into every projection", async () => {
    const body = request([
      textRecord("The private-phrase is searchable"),
      {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "read-normal",
              name: "Read",
              input: { file_path: "/repo/private-phrase.ts" },
            },
          ],
        },
      },
    ]);
    body.context.installation.hostname = "host-private-phrase";
    body.context.cwd = "/repo/private-phrase";
    const accepted = await services.publish(first.context, body);
    const foreign = await services.publish(other.context, {
      ...body,
      batchId: uuidv7(),
    });
    await policies.save(first.owner, null, {
      name: "classified",
      kind: "REGEX",
      pattern: "private-phrase",
      flags: "g",
      enabled: true,
    });
    let rolledBackId = "";
    await expect(
      database.prisma.$transaction(async (tx) => {
        rolledBackId = await jobs.rescan(tx, first.owner, {
          reason: "Transaction rollback experiment",
        });
        throw new Error("Injected before audit commit");
      }),
    ).rejects.toThrow("Injected before audit commit");
    expect(
      await database.prisma.redactionRun.count({ where: { id: rolledBackId } }),
    ).toBe(0);
    const queuedBefore = await database.prisma.$queryRaw<
      { count: number }[]
    >`SELECT count(*)::int AS count FROM pgboss.job WHERE id=${rolledBackId}::uuid`;
    expect(queuedBefore).toEqual([{ count: 0 }]);
    const queued = await admin.rescan(first.owner, {
      reason: "New policy",
      policyIds: [
        (await policies.list(first.owner, {})).result.items.find(
          (row) => row.name === "classified",
        )?.id,
      ],
    });
    const rawJob = await database.prisma.$queryRaw<
      { data: unknown }[]
    >`SELECT data FROM pgboss.job WHERE id=${queued.result.job_id}::uuid`;
    expect(JSON.stringify(rawJob)).not.toContain(first.key);
    expect(JSON.stringify(rawJob)).not.toContain(
      first.owner.headers.get("cookie"),
    );
    await expect(
      jobs.progress(other.owner, queued.result.job_id),
    ).rejects.toMatchObject({ statusCode: 404 });
    const completed = await waitFor(
      first.owner,
      queued.result.job_id,
      "completed",
    );
    expect(completed).toMatchObject({
      total_sessions: 1,
      processed_sessions: 1,
    });
    expect(completed.redaction_count).toBeGreaterThanOrEqual(5);
    const session = await database.prisma.traceSessionControl.findFirstOrThrow({
      where: { id: accepted.result.sessionId },
    });
    expect(
      (
        await database.prisma.installation.findUniqueOrThrow({
          where: {
            organizationId_id: {
              organizationId: session.organizationId,
              id: session.installationId,
            },
          },
        })
      ).hostname,
    ).toBe("host-[REDACTED:classified]");
    const presentation = await header(session.id);
    expect(presentation.cwd).toBe("/repo/[REDACTED:classified]");
    expect(presentation).toMatchObject({
      title: "The [REDACTED:classified] is searchable",
      first_prompt: "The [REDACTED:classified] is searchable",
      branch: "[REDACTED:classified]",
    });
    expect(
      JSON.stringify(wireValue(await rawRecords(session.id))),
    ).not.toContain("private-phrase");
    expect(
      (await publishedMessages(session.id)).find((row) => row.role === "USER")
        ?.search_text,
    ).toBe(presentation.first_prompt);
    expect((await files(session.id))[0]?.id).toBe("[REDACTED:classified].ts");
    expect((await header(foreign.result.sessionId)).title).toContain(
      "private-phrase",
    );
    expect(
      await database.prisma.auditEvent.count({
        where: {
          action: "redaction.rescan.session",
          resourceIds: { has: session.id },
          statusCode: 200,
        },
      }),
    ).toBe(1);
    expect(workerErrors).toEqual([]);
  });

  // @req R-RED-06 @req R-ING-09 @req R-MOD-02
  it("rebuilds a prior displayed PI branch while a newer leaf is pending, and skips queued tombstones", async () => {
    const organization = await provisionOrganization(database, "jobs-pending");
    const body = request(
      [
        {
          type: "message",
          id: "a",
          parentId: null,
          message: {
            role: "user",
            content: [{ type: "text", text: "pending-sensitive" }],
          },
        },
      ],
      "PI",
    );
    body.context.activeLeafId = "a";
    const accepted = await services.publish(organization.context, body);
    const pending = await services.ingest.execute(organization.context, {
      ...body,
      batchId: uuidv7(),
      records: [],
      sentAt: new Date(Date.parse(body.sentAt) + 1000).toISOString(),
      context: { ...body.context, activeLeafId: "not-arrived" },
    });
    expect(pending.result.publication).toBe("queued");
    await services.projection.process(
      requireCaller(organization.context).organizationId,
      pending.result.sessionId,
    );
    await expect
      .poll(
        async () =>
          (
            await database.prisma.traceSessionControl.findFirstOrThrow({
              where: { id: pending.result.sessionId },
            })
          ).projectionState,
      )
      .toBe("waiting_source");
    const tombstone = await services.publish(
      organization.context,
      request([textRecord("purged target")]),
    );
    await policies.save(organization.owner, null, {
      name: "pending",
      kind: "REGEX",
      pattern: "pending-sensitive",
      flags: "g",
    });
    const queued = await admin.rescan(organization.owner, {
      reason: "Rescan pending branch",
    });
    await admin.purge(organization.owner, {
      session_id: tombstone.result.sessionId,
      reason: "Purge before queued rescan",
    });
    const completed = await waitFor(
      organization.owner,
      queued.result.job_id,
      "completed",
    );
    expect(completed).toMatchObject({
      total_sessions: 2,
      processed_sessions: 2,
    });
    expect(
      (await publishedMessages(accepted.result.sessionId))[0]?.content,
    ).toBe("[REDACTED:pending]");
    expect(
      (
        await database.traceReaders.read(
          requireCaller(organization.context),
          (client) =>
            client.query(
              "SELECT message_id FROM messages WHERE session_id={id:UUID}",
              { id: tombstone.result.sessionId },
            ),
        )
      ).rows.length,
    ).toBe(0);
    expect(
      (
        await database.prisma.traceSessionControl.findFirstOrThrow({
          where: { id: accepted.result.sessionId },
        })
      ).normalizerContext,
    ).toMatchObject({ activeLeafId: "not-arrived" });
  });

  // @req R-RED-06 @req R-AUD-01
  it("retries an interrupted session transaction without duplicate successful audits", async () => {
    const organization = await provisionOrganization(database, "jobs-retry");
    const accepted = await services.publish(
      organization.context,
      request([textRecord("retry-test")]),
    );
    const write = database.audit.write.bind(database.audit);
    let interrupted = false;
    const spy = vi
      .spyOn(database.audit, "write")
      .mockImplementation(async (context, operation, tx) => {
        if (
          !interrupted &&
          tx &&
          operation.action === "redaction.rescan.session" &&
          operation.resourceIds?.includes(accepted.result.sessionId)
        ) {
          interrupted = true;
          throw new Error(
            "Injected immediately before session checkpoint commit",
          );
        }
        return write(context, operation, tx);
      });
    try {
      const queued = await admin.rescan(organization.owner, {
        reason: "Retry experiment",
      });
      await waitFor(organization.owner, queued.result.job_id, "completed");
      expect(interrupted).toBe(true);
      expect(
        await database.prisma.auditEvent.count({
          where: {
            action: "redaction.rescan.session",
            resourceIds: { has: accepted.result.sessionId },
            statusCode: 200,
          },
        }),
      ).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });

  // @req R-AUD-01
  it("rolls back failed-run state when its failure audit fails, then completes through a native retry", async () => {
    const organization = await provisionOrganization(
      database,
      "jobs-failure-audit",
    );
    const accepted = await services.publish(
      organization.context,
      request([textRecord("failure audit retry")]),
    );
    const write = database.audit.write.bind(database.audit);
    let interrupted = false;
    let failureAuditRejected = false;
    const spy = vi
      .spyOn(database.audit, "write")
      .mockImplementation(async (context, operation, tx) => {
        if (
          !interrupted &&
          tx &&
          operation.action === "redaction.rescan.session" &&
          operation.resourceIds?.includes(accepted.result.sessionId)
        ) {
          interrupted = true;
          throw new Error("Injected session transaction failure");
        }
        if (
          interrupted &&
          !failureAuditRejected &&
          operation.action === "redaction.rescan.session" &&
          operation.statusCode === 500
        ) {
          expect(tx).toBeDefined();
          failureAuditRejected = true;
          throw new Error("Injected failure audit rejection");
        }
        return write(context, operation, tx);
      });
    try {
      const queued = await admin.rescan(organization.owner, {
        reason: "Check failure audit atomicity",
      });
      const deadline = Date.now() + 20_000;
      for (;;) {
        const state = await database.prisma.$queryRaw<
          { state: string }[]
        >`SELECT state FROM pgboss.job WHERE id=${queued.result.job_id}::uuid`;
        if (state[0]?.state === "retry") break;
        if (Date.now() >= deadline)
          throw new Error("The failed operation did not reach native retry.");
        await delay(25);
      }
      expect(failureAuditRejected).toBe(true);
      expect(
        await database.prisma.redactionRun.findUnique({
          where: {
            organizationId_id: {
              organizationId: organization.owner.caller?.organizationId ?? "",
              id: queued.result.job_id,
            },
          },
        }),
      ).toMatchObject({ state: "queued", processedSessions: 0, error: null });
      expect(
        await database.prisma.auditEvent.count({
          where: {
            action: "redaction.rescan.session",
            resourceIds: { has: queued.result.job_id },
            statusCode: 500,
          },
        }),
      ).toBe(0);
      await waitFor(organization.owner, queued.result.job_id, "completed");
      expect(
        await database.prisma.auditEvent.count({
          where: {
            action: "redaction.rescan.session",
            resourceIds: { has: accepted.result.sessionId },
            statusCode: 200,
          },
        }),
      ).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });

  // @req R-ORG-04 @req R-ORG-09
  it("stops a queued job after its initiating API key is revoked", async () => {
    const organization = await provisionOrganization(database, "jobs-revoked");
    const accepted = await services.publish(
      organization.context,
      request([textRecord("revoked actor contents")]),
    );
    const queued = await admin.rescan(organization.context, {
      reason: "Revoke queued actor",
    });
    const keyId = organization.context.caller?.apiKeyId;
    if (!keyId) throw new Error("Missing key");
    await database.prisma.apikey.update({
      where: { id: keyId },
      data: { enabled: false },
    });
    expect(
      await waitFor(organization.owner, queued.result.job_id, "failed"),
    ).toMatchObject({ processed_sessions: 0 });
    expect(
      await database.prisma.auditEvent.count({
        where: {
          action: "redaction.rescan.session",
          resourceIds: { has: accepted.result.sessionId },
          statusCode: 200,
        },
      }),
    ).toBe(0);
  });

  // @req R-AUD-03 @req R-EMB-01
  it("enforces audit retention and six-hour inactivity without generating disabled embedding jobs", async () => {
    const accepted = await services.publish(
      first.context,
      request([textRecord("idle session")]),
    );
    const old = new Date(Date.now() - 31 * 86_400_000);
    const staleAudit = await database.prisma.auditEvent.findFirstOrThrow({
      where: {
        organizationId: first.context.caller?.organizationId ?? "missing",
      },
    });
    const oldAudit = await database.prisma.auditEvent.create({
      data: {
        ...staleAudit,
        id: uuidv7(),
        ts: old,
        detail: staleAudit.detail ?? Prisma.JsonNull,
      },
    });
    await database.prisma.traceSessionControl.updateMany({
      where: { id: accepted.result.sessionId },
      data: { lastActivityAt: new Date(Date.now() - 7 * 3_600_000) },
    });
    await jobs.maintenance();
    expect(
      await database.prisma.auditEvent.findUnique({
        where: { id: oldAudit.id },
      }),
    ).toBeNull();
    expect(
      await database.prisma.traceSessionControl.findFirst({
        where: { id: accepted.result.sessionId },
      }),
    ).toMatchObject({ status: "INACTIVE" });
    const embeddings = await database.prisma.$queryRaw<
      { count: number }[]
    >`SELECT count(*)::int AS count FROM pgboss.job WHERE name=${JOB_QUEUES.embedding}`;
    expect(embeddings).toEqual([{ count: 0 }]);
    expect(workerErrors).toEqual([]);
  });
});

// @req R-RED-01 @req R-RED-02 @req R-RED-06 @req R-AUD-03
it("applies anchored policies to stored JSON values during ingestion, rescan and audited reads", async () => {
  const org = await provisionOrganization(database, "anchored-policy-values");
  const records = [
    textRecord("needle"),
    {
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            id: "anchored-call",
            name: "Search",
            input: { query: "needle" },
          },
        ],
      },
    },
  ];
  const prior = await services.publish(org.context, request(records));
  const foreign = await services.publish(other.context, request(records));
  const saved = await policies.save(org.owner, null, {
    name: "anchored-value",
    kind: "REGEX",
    pattern: "^needle$",
    flags: "g",
    enabled: true,
  });
  const scan = await admin.rescan(org.owner, {
    reason: "Apply anchored value policy",
    policyIds: [saved.result.id],
  });
  const progress = await waitFor(org.owner, scan.result.job_id, "completed");
  expect(progress.processed_sessions).toBe(1);
  const later = request(records);
  later.context.installation.hostname = "needle";
  if (later.context.git) later.context.git.branch = "needle";
  const accepted = await services.publish(org.context, later);
  for (const sessionId of [prior.result.sessionId, accepted.result.sessionId]) {
    const raw = await rawRecords(sessionId);
    expect(JSON.stringify(wireValue(raw))).not.toContain('"needle"');
    expect(JSON.stringify(wireValue(raw))).toContain(
      "[REDACTED:anchored-value]",
    );
    const messages = await publishedMessages(sessionId);
    expect(JSON.stringify(wireValue(messages))).not.toContain('"needle"');
    const presentation = await header(sessionId);
    expect(presentation.first_prompt).toBe("[REDACTED:anchored-value]");
    expect(presentation.title).toBe("[REDACTED:anchored-value]");
  }
  const foreignRaw = await rawRecords(foreign.result.sessionId);
  expect(JSON.stringify(wireValue(foreignRaw))).toContain('"needle"');
  const audit = await database.audit.write(org.owner, {
    action: "search",
    detail: { input: { query: "needle" } },
  });
  const row = await database.prisma.auditEvent.findUniqueOrThrow({
    where: { id: audit.id },
  });
  expect(row.detail).toMatchObject({
    input: { query: "[REDACTED:anchored-value]" },
  });
  expect(workerErrors).toEqual([]);
});
