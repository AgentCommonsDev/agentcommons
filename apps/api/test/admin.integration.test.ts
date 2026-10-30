import { startTraceDatabase } from "../../../packages/traces/test/support.js";
import { TraceFixtures } from "../../../packages/traces/test/fixtures.js";
import { traceServices } from "./trace-services.js";
import { beforeAll, afterAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { PrismaClient, type Prisma } from "@agentcommons/db";
import { z } from "zod";
import { AdminService, type AdminJobs } from "../src/services/admin.js";
import { CursorCodec } from "../src/services/cursor.js";
import type { IngestService } from "../src/services/ingest.js";
import { SessionService } from "../src/services/session.js";
import { reauthorizeJob } from "../src/auth/jobs.js";
import {
  contextFor,
  provisionMember,
  provisionOrganization,
  releaser,
} from "./support.js";
import { testEnvelope, textRecord } from "./envelopes.js";
import { requireCaller, type ServiceContext } from "../src/services/context.js";
let database: Awaited<ReturnType<typeof startTraceDatabase>>;
let organization: Awaited<ReturnType<typeof provisionOrganization>>;
let other: Awaited<ReturnType<typeof provisionOrganization>>;
let admin: AdminService;
let ingest: Pick<IngestService, "execute">;
let native: ReturnType<typeof traceServices>;
let fixtures: TraceFixtures;
let sessions: SessionService;
let reader: ServiceContext;
let adminOnly: ServiceContext;
const reason = "Administrative review";
function envelope(text = "Review session contents") {
  return testEnvelope({
    sentAt: "2026-09-07T01:00:00Z",
    cursor: "1:0",
    context: {
      installation: { hostname: "admin-fixture" },
      git: {
        root: "/repo",
        remoteUrl: "git@github.com:rek7/agentcommons.git",
        branch: "main",
        head: "abc123",
      },
    },
    records: [
      {
        ...textRecord(0, text, {
          uuid: "message",
          timestamp: "2026-09-07T01:00:00Z",
        }),
        key: "message",
      },
    ],
  });
}
async function keyContext(permissions: {
  sessions?: ("read" | "ingest")[];
  admin?: "*"[];
}): Promise<ServiceContext> {
  const key = await database.auth.createKey(organization.owner, {
    name: "Admin integration",
    permissions,
  });
  return contextFor(
    database,
    new Headers({ authorization: `Bearer ${key.result.key}` }),
  );
}
const { defer, release } = releaser();
beforeAll(async () => {
  database = await startTraceDatabase();
  defer(() => database.close());
  native = traceServices(database);
  defer(() => native.close());
  fixtures = new TraceFixtures(database);
  defer(() => fixtures.close());
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
    enqueue: (tx, data) => native.jobs.enqueue(tx, data),
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
    readers: database.traceReaders,
    prisma: database.prisma,
    audit: database.audit,
    cursors,
    jobs,
    server: { version: "test-release", autoUpdate: false },
  });
  ingest = { execute: (context, input) => native.publish(context, input) };
  sessions = new SessionService({
    prisma: database.prisma,
    readers: database.traceReaders,
    audit: database.audit,
    cursors,
  });
  reader = await keyContext({ sessions: ["read"] });
  adminOnly = await keyContext({ admin: ["*"] });
}, 120_000);
afterAll(release);

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
    (await sessions.get(reader, { session_id: id })).result.header?.session_id,
  ).toBe(id);
  expect(
    (
      await admin.auditLog(adminOnly, {
        filters: { action: "sessions.visibility", resource_id: id },
        limit: 1,
      })
    ).result.items,
  ).toHaveLength(1);
  const status = (await admin.status(adminOnly)).result;
  expect(status.ingest_per_day.some((day) => day.count > 0)).toBe(true);
  // @req R-INF-10: the release this server runs and its host's update setting; no
  // updater state file is mounted here, so the host updater reports nothing.
  expect(status.server).toEqual({
    version: "test-release",
    auto_update: false,
    updater: null,
  });
});

// @req R-MOD-01
it("cascades visibility to descendant subagents and restores them together", async () => {
  const orgId = z.string().parse(organization.context.caller?.organizationId);
  const rootId = (await ingest.execute(organization.context, envelope())).result
    .sessionId;
  const childId = (
    await fixtures.sessionFor(organization.context, {
      parent: rootId,
      fields: { title: "subagent" },
    })
  ).id;
  const visibility = async (id: string) =>
    (
      await database.prisma.traceSessionControl.findUniqueOrThrow({
        where: { organizationId_id: { organizationId: orgId, id } },
      })
    ).visibility;
  // Hiding the parent hides the run that belongs to it.
  await admin.setVisibility(adminOnly, {
    session_id: rootId,
    visibility: "PRIVATE",
    reason,
  });
  expect(await visibility(rootId)).toBe("PRIVATE");
  expect(await visibility(childId)).toBe("PRIVATE");
  // Restoring the parent restores the subagent with it.
  await admin.setVisibility(adminOnly, {
    session_id: rootId,
    visibility: "PUBLIC",
    reason,
  });
  expect(await visibility(childId)).toBe("PUBLIC");
});

// @req R-MOD-02
it("cascades a purge to descendant subagents and a re-run catches ones a prior purge missed", async () => {
  const orgId = z.string().parse(organization.context.caller?.organizationId);
  const rootId = (await ingest.execute(organization.context, envelope())).result
    .sessionId;
  const childA = (
    await fixtures.sessionFor(organization.context, {
      parent: rootId,
      fields: { title: "subagent A" },
    })
  ).id;
  const control = (id: string) =>
    database.prisma.traceSessionControl.findUniqueOrThrow({
      where: { organizationId_id: { organizationId: orgId, id } },
    });
  const first = await admin.purge(adminOnly, { session_id: rootId, reason });
  expect(first.result.updated).toBe(true);
  expect((await control(rootId)).purgedAt).not.toBeNull();
  expect((await control(childA)).purgedAt).not.toBeNull();
  // The subagent's corpus cleanup is queued like the root's.
  expect(
    await database.prisma.traceOutbox.count({
      where: { organizationId: orgId, sessionId: childA, kind: "purge" },
    }),
  ).toBe(1);
  // A subagent that arrives after the root was purged is caught by a re-run, even though the
  // root itself is already a tombstone.
  const childB = (
    await fixtures.sessionFor(organization.context, {
      parent: rootId,
      fields: { title: "subagent B" },
    })
  ).id;
  expect((await control(childB)).purgedAt).toBeNull();
  const second = await admin.purge(adminOnly, { session_id: rootId, reason });
  expect(second.result.updated).toBe(true);
  expect((await control(childB)).purgedAt).not.toBeNull();
  // With nothing left un-purged, a further run is a no-op.
  const third = await admin.purge(adminOnly, { session_id: rootId, reason });
  expect(third.result.updated).toBe(false);
});

// @req R-MOD-02
it("purges every declared row type, clears derived metadata, retains receipts and identity, and reports an exact idempotent manifest", async () => {
  const request = envelope("Contains token ac_abcdefghijklmnopqrstuvwxyz");
  const id = (await ingest.execute(organization.context, request)).result
    .sessionId;
  const orgId = z.string().parse(organization.context.caller?.organizationId);
  const messages = await database.traceReaders.read(
    requireCaller(organization.context),
    (client) =>
      client.query(
        "SELECT message_id FROM messages WHERE session_id={id:UUID}",
        { id },
      ),
  );
  const messageId = z.string().parse(messages.rows[0]?.message_id);
  await fixtures.insert("session_files", id, {
    file_id: "src/private.ts",
    path: "src/private.ts",
    ops: ["write"],
  });
  const vector = Array.from({ length: 1024 }, () => 0.1);
  await fixtures.insert("message_chunks", id, {
    chunk_id: randomUUID(),
    message_id: messageId,
    ordinal: 0,
    content: "chunk",
    content_hash: "a".repeat(64),
    token_count: 1,
    model: "fixture",
    embedding: vector,
  });
  await fixtures.insert("session_embeddings", id, {
    model: "fixture",
    token_count: 1,
    updated_at: new Date(),
    embedding: vector,
  });
  await database.prisma.traceSessionControl.update({
    where: { organizationId_id: { organizationId: orgId, id } },
    data: { normalizerContext: { activeLeafId: "private-leaf" } },
  });
  const before = {
    ...(await database.traces.sessionCounts({
      organizationId: orgId,
      sessionId: id,
    })),
    redaction_events: await database.prisma.redactionEvent.count({
      where: { sessionId: id },
    }),
  };
  expect(before.redaction_events).toBeGreaterThan(0);
  const result = await admin.purge(adminOnly, { session_id: id, reason });
  expect(result.result.cleanup).toBe("queued");
  expect(result.result.manifest.deleted.raw_records).toBeNull();
  await native.projection.process(orgId, id);
  const complete = await admin.purge(adminOnly, { session_id: id, reason });
  expect(complete.result.cleanup).toBe("completed");
  expect(complete.result.manifest.deleted).toEqual(before);
  expect(result.result.manifest.reset_fields).toContain("normalizer_context");
  const tombstone = await database.prisma.traceSessionControl.findUniqueOrThrow(
    { where: { organizationId_id: { organizationId: orgId, id } } },
  );
  expect(tombstone).toMatchObject({
    normalizerContext: {},
    projectedContext: {},
  });
  expect(tombstone.purgedAt).not.toBeNull();
  const skeleton = await sessions.get(organization.context, { session_id: id });
  expect(skeleton.result.header).toMatchObject({
    title: null,
    branch: null,
    message_count: 0,
    input_tokens: "0",
    output_tokens: "0",
    tools_used: [],
  });
  expect(skeleton.result.messages).toEqual([]);
  expect(
    await database.prisma.traceReceipt.count({ where: { sessionId: id } }),
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
  expect(repeated.result.manifest.deleted).toEqual(before);
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
  const orgId = z.string().parse(organization.context.caller?.organizationId);
  await native.projection.process(orgId, id);
  const counts = await database.traces.sessionCounts({
    organizationId: orgId,
    sessionId: id,
  });
  expect(counts.raw_records).toBe(0);
  expect(counts.messages).toBe(0);
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
  const policy = database.authConfiguration;
  const actor = await reauthorizeJob(database.prisma, adminOnly, policy);
  expect(actor.caller?.role).toBe("owner");
  await expect(
    reauthorizeJob(database.prisma, adminOnly, {
      ...policy,
      allowedEmailDomains: ["elsewhere.test"],
    }),
  ).rejects.toMatchObject({ statusCode: 403 });
  const keyId = z.string().parse(adminOnly.caller?.apiKeyId);
  await database.auth.revokeKey(organization.owner, keyId, { reason });
  await expect(
    reauthorizeJob(database.prisma, adminOnly, policy),
  ).rejects.toMatchObject({ statusCode: 403 });
});

// @req R-MOD-04
it("lists every control session for moderation with its publication, visibility and purge state, filters, and one total across pages", async () => {
  const orgId = z.string().parse(organization.context.caller?.organizationId);
  const owner = requireCaller(organization.context);
  const marker = `Moderation ${randomUUID()}`;
  // The reauthorization test above revokes the shared admin key; moderate with a fresh
  // one that also reads, so the member list can be compared under admin visibility.
  const moderator = await keyContext({ sessions: ["read"], admin: ["*"] });
  const root = (
    await ingest.execute(organization.context, envelope(`${marker} root`))
  ).result.sessionId;
  const child = (
    await fixtures.sessionFor(organization.context, {
      parent: root,
      fields: { title: `${marker} child` },
    })
  ).id;
  const hidden = (
    await ingest.execute(organization.context, envelope(`${marker} private`))
  ).result.sessionId;
  await admin.setVisibility(moderator, {
    session_id: hidden,
    visibility: "PRIVATE",
    reason,
  });
  const purged = (
    await ingest.execute(organization.context, envelope(`${marker} purged`))
  ).result.sessionId;
  await admin.purge(moderator, { session_id: purged, reason });
  // A capture whose native transcript never arrived: a control row without a published
  // revision, which no reader view admits but the moderation routes act on.
  const pending = randomUUID();
  const rootControl =
    await database.prisma.traceSessionControl.findUniqueOrThrow({
      where: { organizationId_id: { organizationId: orgId, id: root } },
    });
  await database.prisma.traceSessionControl.create({
    data: {
      id: pending,
      organizationId: orgId,
      harness: "GEMINI_CLI",
      nativeIdentity: pending,
      harnessSessionId: `native-${pending}`,
      userId: owner.userId,
      ingestApiKeyId: z.string().parse(owner.apiKeyId),
      installationId: rootControl.installationId,
      startedAt: new Date("2026-01-01T00:00:00Z"),
      lastActivityAt: new Date("2026-01-01T00:00:00Z"),
      projectionState: "waiting_source",
      projectionError: "Waiting for the native transcript branch to arrive.",
    },
  });
  const expected = [root, child, hidden, purged, pending];
  // The member list, the page's former source, never shows the unpublished capture, and
  // a purge removes the session from browsing even for admins (ADR 0088).
  const readModel = await sessions.list(moderator, { limit: 100 });
  const listed = readModel.result.items.map((item) => item.session_id);
  expect(listed).toEqual(expect.arrayContaining([root, child, hidden]));
  expect(listed).not.toContain(purged);
  expect(listed).not.toContain(pending);
  // The moderation list pages through every control row and states one total.
  const items = new Map<
    string,
    Awaited<ReturnType<typeof admin.sessions>>["result"]["items"][number]
  >();
  let cursor: string | null = null;
  let total: number | undefined;
  do {
    const page = await admin.sessions(moderator, {
      limit: 2,
      ...(cursor ? { cursor } : {}),
    });
    total ??= page.result.total.sessions;
    expect(page.result.total.sessions).toBe(total);
    for (const item of page.result.items) items.set(item.session_id, item);
    cursor = page.result.cursor;
  } while (cursor);
  expect(items.size).toBe(total);
  expect([...items.keys()]).toEqual(expect.arrayContaining(expected));
  expect(items.get(root)).toMatchObject({
    published: true,
    projection_state: "published",
    visibility: "PUBLIC",
    purged_at: null,
    parent_session_id: null,
    parent_relation: null,
    user_email: organization.email,
    installation_hostname: "admin-fixture",
    harness: "CLAUDE_CODE",
  });
  expect(items.get(root)?.title).toContain(marker);
  expect(items.get(root)?.message_count).toBeGreaterThan(0);
  expect(items.get(child)).toMatchObject({
    published: true,
    parent_session_id: root,
    parent_relation: "SUBAGENT",
    title: `${marker} child`,
    harness: "CODEX",
  });
  expect(items.get(hidden)).toMatchObject({
    visibility: "PRIVATE",
    purged_at: null,
  });
  expect(items.get(purged)).toMatchObject({
    published: true,
    title: null,
    repo_name: null,
  });
  expect(items.get(purged)?.purged_at).not.toBeNull();
  expect(items.get(pending)).toMatchObject({
    published: false,
    projection_state: "waiting_source",
    title: null,
    repo_name: null,
    message_count: null,
    harness: "GEMINI_CLI",
    harness_session_id: `native-${pending}`,
    user_email: organization.email,
    installation_hostname: "admin-fixture",
    started_at: "2026-01-01T00:00:00.000Z",
  });
  // Every state is a filter, and the total follows the filter, not the page.
  const ids = async (input: Record<string, unknown>) => {
    const page = await admin.sessions(moderator, { limit: 100, ...input });
    expect(page.result.total.sessions).toBe(page.result.items.length);
    return page.result.items.map((item) => item.session_id);
  };
  expect(await ids({ filters: { published: false } })).toContain(pending);
  expect(await ids({ filters: { published: false } })).not.toContain(root);
  expect(await ids({ filters: { purged: true } })).toContain(purged);
  expect(await ids({ filters: { purged: true } })).not.toContain(root);
  expect(await ids({ filters: { visibility: "PRIVATE" } })).toContain(hidden);
  expect(await ids({ filters: { visibility: "PRIVATE" } })).not.toContain(root);
  const roots = await ids({ roots_only: true });
  expect(roots).toContain(root);
  expect(roots).not.toContain(child);
  expect(await ids({ filters: { harness: "GEMINI_CLI" } })).toContain(pending);
  expect(
    await ids({ filters: { since: "2026-01-02T00:00:00Z" } }),
  ).not.toContain(pending);
  expect(await ids({ filters: { session_id: pending } })).toEqual([pending]);
  expect(
    (
      await admin.sessions(moderator, {
        sort: "started_at",
        order: "asc",
        limit: 1,
      })
    ).result.items[0]?.session_id,
  ).toBe(pending);
  // Read keys and other organizations get nothing; the read is audited.
  await expect(admin.sessions(reader, {})).rejects.toMatchObject({
    statusCode: 403,
  });
  expect(await ids({})).toEqual(expect.arrayContaining(expected));
  const foreign = await admin.sessions(other.context, { limit: 100 });
  expect(
    foreign.result.items.some((item) => expected.includes(item.session_id)),
  ).toBe(false);
  expect(
    (
      await admin.auditLog(moderator, {
        filters: { action: "sessions.moderation" },
        limit: 1,
      })
    ).result.items,
  ).toHaveLength(1);
});

// @req R-MOD-05
it("lets an owner cookie session change visibility and purge while a member cookie or key is refused, with both outcomes audited", async () => {
  const id = (
    await ingest.execute(
      organization.context,
      envelope("Moderated from the session page"),
    )
  ).result.sessionId;
  const moderator = await keyContext({ admin: ["*"] });
  const member = await provisionMember(
    database,
    organization.owner,
    `moderation-member-${randomUUID()}@example.com`,
  );
  await expect(
    admin.setVisibility(member.owner, {
      session_id: id,
      visibility: "PRIVATE",
      reason,
    }),
  ).rejects.toMatchObject({ statusCode: 403 });
  await expect(
    admin.purge(member.owner, { session_id: id, reason }),
  ).rejects.toMatchObject({ statusCode: 403 });
  await expect(admin.sessions(member.owner, {})).rejects.toMatchObject({
    statusCode: 403,
  });
  await expect(admin.sessions(member.context, {})).rejects.toMatchObject({
    statusCode: 403,
  });
  const hidden = await admin.setVisibility(organization.owner, {
    session_id: id,
    visibility: "PRIVATE",
    reason,
  });
  expect(hidden.result.updated).toBe(true);
  const listed = async () => {
    const page = await admin.sessions(organization.owner, {
      filters: { session_id: id },
    });
    const item = page.result.items[0];
    if (!item) throw new Error("Expected the moderated session in the list.");
    return item;
  };
  expect(await listed()).toMatchObject({
    visibility: "PRIVATE",
    purged_at: null,
  });
  const purge = await admin.purge(organization.owner, {
    session_id: id,
    reason,
  });
  expect(purge.result.updated).toBe(true);
  expect((await listed()).purged_at).not.toBeNull();
  const memberUserId = requireCaller(member.owner).userId;
  const refused = await admin.auditLog(moderator, {
    filters: { user_id: memberUserId, status_code: 403 },
    limit: 20,
  });
  expect(refused.result.items.map((row) => row.action)).toEqual(
    expect.arrayContaining([
      "sessions.visibility",
      "sessions.purge",
      "sessions.moderation",
    ]),
  );
  const granted = await admin.auditLog(moderator, {
    filters: { resource_id: id },
    limit: 20,
  });
  expect(granted.result.items.map((row) => row.action)).toEqual(
    expect.arrayContaining(["sessions.visibility", "sessions.purge"]),
  );
});
