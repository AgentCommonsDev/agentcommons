import { beforeAll, afterAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { PrismaClient, type Prisma } from "@agentcommons/db";
import { z } from "zod";
import { AdminService, type AdminJobs } from "../src/services/admin.js";
import { CursorCodec } from "../src/services/cursor.js";
import { IngestService } from "../src/services/ingest.js";
import { SessionService } from "../src/services/session.js";
import { reauthorizeJob } from "../src/auth/jobs.js";
import { operatorContext } from "../src/auth/bootstrap.js";
import { startDatabase, provisionOrganization } from "./support.js";
import type { ServiceContext } from "../src/services/context.js";
let database: Awaited<ReturnType<typeof startDatabase>>;
let organization: Awaited<ReturnType<typeof provisionOrganization>>;
let other: Awaited<ReturnType<typeof provisionOrganization>>;
let admin: AdminService;
let ingest: IngestService;
let sessions: SessionService;
let reader: ServiceContext;
let adminOnly: ServiceContext;
const reason = "Administrative review";
function envelope(text = "Review session contents") {
  return {
    envelopeVersion: 2,
    harness: "CLAUDE_CODE",
    harnessSessionId: randomUUID(),
    behavior: "sync",
    nativeEvent: "Stop",
    batchId: randomUUID(),
    installationId: randomUUID(),
    sourcePos: 0,
    sentAt: "2026-09-07T01:00:00Z",
    context: {
      cwd: "/repo",
      installation: {
        hostname: "admin-fixture",
        osUser: "developer",
        platform: "linux",
        arch: "x64",
      },
      git: {
        root: "/repo",
        remoteUrl: "git@github.com:rek7/agentcommons.git",
        branch: "main",
        head: "abc123",
      },
      parentHint: null,
    },
    records: [
      {
        pos: 0,
        sourceVersion: 0,
        key: "message",
        line: JSON.stringify({
          type: "user",
          uuid: "message",
          timestamp: "2026-09-07T01:00:00Z",
          message: { content: [{ type: "text", text }] },
        }),
      },
    ],
    cursor: "1:0",
    end: null,
  };
}
async function keyContext(permissions: {
  sessions?: ("read" | "ingest")[];
  admin?: "*"[];
}): Promise<ServiceContext> {
  const key = await database.auth.createKey(organization.owner, {
    name: "Admin integration",
    permissions,
  });
  const headers = new Headers({ authorization: `Bearer ${key.result.key}` });
  const base = { ...operatorContext(), headers };
  return {
    ...base,
    caller: (await database.auth.authenticate(headers, base)).caller,
  };
}
beforeAll(async () => {
  database = await startDatabase();
  organization = await provisionOrganization(database, "admin-primary");
  other = await provisionOrganization(database, "admin-other");
  const migration = new PrismaClient({
    datasourceUrl: database.urls.migration,
  });
  try {
    await migration.$executeRaw`CREATE TABLE test_admin_job (id uuid PRIMARY KEY, organization_id text NOT NULL, payload jsonb NOT NULL)`;
    await migration.$executeRaw`GRANT SELECT,INSERT ON test_admin_job TO ac_app`;
  } finally {
    await migration.$disconnect();
  }
  const jobs: AdminJobs = {
    async rescan(tx, context, input) {
      const id = randomUUID();
      await tx.$executeRaw`INSERT INTO test_admin_job(id,organization_id,payload) VALUES(${id}::uuid,${context.caller?.organizationId},${JSON.stringify({ input, actor: context.caller })}::jsonb)`;
      return id;
    },
    async status(organizationId) {
      const count = await database.prisma.$queryRaw<
        { count: number }[]
      >`SELECT count(*)::int AS count FROM test_admin_job WHERE organization_id=${organizationId}`;
      return {
        queue_depth: count[0]?.count ?? 0,
        embedding_backlog: 0,
        embedding_daily_tokens: "0",
        embedding_daily_cost: "0",
      };
    },
  };
  const cursors = new CursorCodec("admin-integration-secret");
  admin = new AdminService({
    readers: database.readers,
    prisma: database.prisma,
    audit: database.audit,
    cursors,
    policies: database.policies,
    jobs,
  });
  ingest = new IngestService({
    prisma: database.prisma,
    audit: database.audit,
    policies: database.policies,
  });
  sessions = new SessionService({
    prisma: database.prisma,
    readers: database.readers,
    audit: database.audit,
    cursors,
  });
  reader = await keyContext({ sessions: ["read"] });
  adminOnly = await keyContext({ admin: ["*"] });
}, 120_000);
afterAll(async () => {
  await database.close();
});

it("supports admin-only keys and applies visibility only to the authenticated organization", async () => {
  const id = (await ingest.execute(organization.context, envelope())).result
    .sessionId;
  await expect(
    admin.setVisibility(reader, {
      session_id: id,
      visibility: "PRIVATE",
      reason,
    }),
  ).rejects.toMatchObject({ statusCode: 403 });
  await expect(
    admin.setVisibility(other.context, {
      session_id: id,
      visibility: "PRIVATE",
      reason,
    }),
  ).rejects.toMatchObject({ statusCode: 404 });
  expect(
    (
      await admin.setVisibility(adminOnly, {
        session_id: id,
        visibility: "PRIVATE",
        reason,
      })
    ).result.updated,
  ).toBe(true);
  await expect(sessions.get(reader, { session_id: id })).rejects.toMatchObject({
    statusCode: 404,
  });
  expect(
    (
      await admin.setVisibility(adminOnly, {
        session_id: id,
        visibility: "PUBLIC",
        reason,
      })
    ).result.updated,
  ).toBe(true);
  expect(
    (await sessions.get(reader, { session_id: id })).result.header.session_id,
  ).toBe(id);
  expect(
    (
      await admin.auditLog(adminOnly, {
        filters: { action: "sessions.visibility", resource_id: id },
        limit: 1,
      })
    ).result.items,
  ).toHaveLength(1);
  expect(
    (await admin.status(adminOnly)).result.ingest_per_day.some(
      (day) => day.count > 0,
    ),
  ).toBe(true);
});

// @req R-MOD-02
it("purges every declared row type, clears derived metadata, retains receipts and identity, and reports an exact idempotent manifest", async () => {
  const request = envelope("Contains token ac_abcdefghijklmnopqrstuvwxyz");
  const id = (await ingest.execute(organization.context, request)).result
    .sessionId;
  const orgId = z.string().parse(organization.context.caller?.organizationId);
  const message = await database.prisma.message.findFirstOrThrow({
    where: { sessionId: id },
  });
  await database.prisma.sessionFile.create({
    data: {
      organizationId: orgId,
      sessionId: id,
      path: "src/private.ts",
      ops: ["write"],
    },
  });
  const vector = `[${Array.from({ length: 1024 }, () => "0.1").join(",")}]`;
  await database.prisma
    .$executeRaw`INSERT INTO message_chunk(organization_id,id,session_id,message_id,ordinal,content,token_count,model,embedding) VALUES(${orgId},${randomUUID()}::uuid,${id}::uuid,${message.id}::uuid,0,'chunk',1,'fixture',${vector}::vector)`;
  await database.prisma
    .$executeRaw`INSERT INTO session_embedding(organization_id,session_id,model,token_count,updated_at,embedding) VALUES(${orgId},${id}::uuid,'fixture',1,now(),${vector}::vector)`;
  await database.prisma.agentSession.update({
    where: { id },
    data: {
      normalizerContext: { activeLeafId: "private-leaf" },
      observedCommits: [{ sha: "private" }],
      observedDiffStat: { text: "private" },
      inputTokens: 100,
      outputTokens: 20,
      toolCallCount: 1,
      toolsUsed: ["private-tool"],
    },
  });
  const before = {
    raw_records: await database.prisma.rawRecord.count({
      where: { sessionId: id },
    }),
    messages: await database.prisma.message.count({ where: { sessionId: id } }),
    session_files: 1,
    message_chunks: 1,
    session_embeddings: 1,
    redaction_events: await database.prisma.redactionEvent.count({
      where: { sessionId: id },
    }),
  };
  expect(before.redaction_events).toBeGreaterThan(0);
  const result = await admin.purge(adminOnly, { session_id: id, reason });
  expect(result.result.manifest.deleted).toEqual(before);
  expect(result.result.manifest.reset_fields).toContain("normalizer_context");
  const tombstone = await database.prisma.agentSession.findUniqueOrThrow({
    where: { id },
  });
  expect(tombstone).toMatchObject({
    title: null,
    firstPrompt: null,
    observedCommits: null,
    observedDiffStat: null,
    branch: null,
    normalizerContext: {},
    projectedContext: {},
    messageCount: 0,
    toolCallCount: 0,
    inputTokens: 0n,
    outputTokens: 0n,
    toolsUsed: [],
  });
  expect(tombstone.purgedAt).not.toBeNull();
  expect(
    await database.prisma.ingestBatch.count({ where: { sessionId: id } }),
  ).toBe(1);
  expect(
    await database.prisma.auditEvent.count({
      where: { resourceIds: { has: id } },
    }),
  ).toBeGreaterThan(1);
  await expect(
    ingest.execute(organization.context, { ...request, batchId: randomUUID() }),
  ).rejects.toMatchObject({ statusCode: 409 });
  const repeated = await admin.purge(adminOnly, { session_id: id, reason });
  expect(repeated.result.updated).toBe(false);
  expect(Object.values(repeated.result.manifest.deleted)).toEqual([
    0, 0, 0, 0, 0, 0,
  ]);
});

// @req R-MOD-03
it("serializes purge against a concurrent ingest and leaves no source or derived data behind", async () => {
  const request = envelope();
  const id = (await ingest.execute(organization.context, request)).result
    .sessionId;
  const next = {
    ...request,
    batchId: randomUUID(),
    sourcePos: 1,
    records: [
      {
        ...request.records[0],
        pos: 1,
        key: "late",
        sourceVersion: 0,
        line: JSON.stringify({
          type: "user",
          uuid: "late",
          message: { content: "late message" },
        }),
      },
    ],
  };
  const results = await Promise.allSettled([
    ingest.execute(organization.context, next),
    admin.purge(adminOnly, { session_id: id, reason }),
  ]);
  expect(results[1].status).toBe("fulfilled");
  if (results[0].status === "rejected")
    expect(results[0].reason).toMatchObject({ statusCode: 409 });
  expect(
    await database.prisma.rawRecord.count({ where: { sessionId: id } }),
  ).toBe(0);
  expect(
    await database.prisma.message.count({ where: { sessionId: id } }),
  ).toBe(0);
});

it("scopes audit cursors and atomically enqueues a validated, redacted rescan with its audit", async () => {
  const page = await admin.auditLog(adminOnly, { limit: 1 });
  expect(page.result.cursor).toBeTruthy();
  const nextPage = await admin.auditLog(adminOnly, {
    limit: 1,
    cursor: page.result.cursor,
  });
  expect(nextPage.result.items[0]?.id).not.toBe(page.result.items[0]?.id);
  await expect(
    admin.auditLog(other.context, { limit: 1, cursor: page.result.cursor }),
  ).rejects.toMatchObject({ statusCode: 400 });
  const policy = await database.prisma.redactionPolicy.findFirstOrThrow({
    where: {
      organizationId: organization.context.caller?.organizationId ?? "",
    },
  });
  await expect(
    admin.rescan(other.context, { policyIds: [policy.id], reason }),
  ).rejects.toMatchObject({ statusCode: 404 });
  const queued = await admin.rescan(adminOnly, {
    policyIds: [policy.id],
    reason: "Remove ac_abcdefghijklmnopqrstuvwxyz",
  });
  const stored = await database.prisma.$queryRaw<
    { payload: Prisma.JsonValue }[]
  >`SELECT payload FROM test_admin_job WHERE id=${queued.result.job_id}::uuid`;
  expect(JSON.stringify(stored)).not.toContain("abcdefghijklmnopqrstuvwxyz");
  expect((await admin.status(adminOnly)).result.queue_depth).toBe(1);
  const write = database.audit.write.bind(database.audit);
  const spy = vi
    .spyOn(database.audit, "write")
    .mockImplementation((context, operation, tx) =>
      operation.action === "redaction.rescan" &&
      operation.statusCode === undefined
        ? Promise.reject(new Error("Injected audit failure"))
        : write(context, operation, tx),
    );
  await expect(admin.rescan(adminOnly, { reason })).rejects.toMatchObject({
    statusCode: 500,
  });
  spy.mockRestore();
  expect((await admin.status(adminOnly)).result.queue_depth).toBe(1);
});

it("bounds ascending audit pagination to its first-page timestamp despite each page producing an audit", async () => {
  const maximum = await database.prisma.auditEvent.count({
    where: { organizationId: adminOnly.caller?.organizationId ?? "" },
  });
  const ids: string[] = [];
  let cursor: string | null = null;
  for (let page = 0; page <= maximum + 1; page++) {
    const response = await admin.auditLog(adminOnly, {
      limit: 1,
      order: "asc",
      ...(cursor ? { cursor } : {}),
    });
    ids.push(...response.result.items.map((row) => row.id));
    cursor = response.result.cursor;
    if (!cursor) break;
  }
  expect(cursor).toBeNull();
  expect(ids.length).toBeGreaterThan(0);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids.length).toBeLessThanOrEqual(maximum);
});

it("reauthorizes persisted job actors from current membership, issuer binding, key permissions and domain policy", async () => {
  const actor = await reauthorizeJob(database.prisma, adminOnly);
  expect(actor.caller?.role).toBe("owner");
  await expect(
    reauthorizeJob(database.prisma, adminOnly, ["elsewhere.test"]),
  ).rejects.toMatchObject({ statusCode: 403 });
  const keyId = z.string().parse(adminOnly.caller?.apiKeyId);
  await database.auth.revokeKey(organization.owner, keyId, { reason });
  await expect(
    reauthorizeJob(database.prisma, adminOnly),
  ).rejects.toMatchObject({ statusCode: 403 });
});
