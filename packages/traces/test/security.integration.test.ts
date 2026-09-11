import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  lockTracePublication,
  PrismaClient,
  type ReadAuthority,
} from "@agentcommons/db";
import { startTraceDatabase } from "./support.js";
import { TraceFixtures } from "./fixtures.js";
import { provisionOrganization } from "../../../apps/api/test/support.js";
import { cleanup } from "../../../scripts/cleanup.js";
import {
  createTraceClient,
  NO_TARGET_SESSION_ID,
  SESSION_READS_TABLE,
  TraceReaders,
  traceTables,
  type TraceAudit,
  type TraceSessionRead,
  type TraceTable,
} from "../src/index.js";
import { securityStatements } from "../src/security.js";
import { traceScopeSql } from "../src/views/base.js";
import {
  traceColumnDescriptions,
  traceEmbeddingViews,
  traceViews,
} from "@agentcommons/core/sql";
import { formatSchemaContext } from "@agentcommons/core/format";
import { schemaOutputSchema } from "@agentcommons/core/schemas/rest";
import { callerContextSchema } from "@agentcommons/core/schemas/common";
import { searchTermsSql } from "../src/views/search.js";
import { postgresSourceSql } from "../src/postgres.js";
import { sqlIdentifier, sqlString, tracePrincipal } from "../src/client.js";
import { emptyTraceRow, validateTraceRow } from "../src/rows.js";
let db: Awaited<ReturnType<typeof startTraceDatabase>>;
let fixtures: TraceFixtures;
let owner: ReadAuthority;
let member: ReadAuthority;
let other: ReadAuthority;
let writer: ReturnType<typeof createTraceClient>;
const release: Array<() => Promise<unknown>> = [];
beforeAll(async () => {
  db = await startTraceDatabase();
  release.unshift(() => db.close());
  fixtures = new TraceFixtures(db);
  release.unshift(() => fixtures.close());
  const a = await provisionOrganization(db, "native-security");
  const b = await provisionOrganization(db, "native-foreign");
  owner = callerContextSchema.parse(a.context.caller);
  other = callerContextSchema.parse(b.context.caller);
  // An owner key without admin:* must select the ordinary native principal.
  member = { ...owner, permissions: { sessions: ["read"] } };
  writer = createTraceClient({
    url: db.traceConfig.url,
    database: db.traceConfig.database,
    username: db.traceConfig.username,
    password: db.traceConfig.password,
  });
  release.unshift(() => writer.close());
});
afterAll(async () => {
  expect(await cleanup(release.splice(0))).toEqual([]);
});
/** A published session of the authority's organization on a fresh installation. */
async function seed(
  authority: ReadAuthority,
  visibility: "PUBLIC" | "PRIVATE" = "PUBLIC",
  fields: Record<string, unknown> = {},
) {
  const installationId = randomUUID();
  const userId = z.string().parse(authority.userId);
  const key = await db.prisma.apiKeyOwner.findFirstOrThrow({
    where: { organizationId: authority.organizationId, userId },
  });
  await db.prisma.installation.create({
    data: {
      organizationId: authority.organizationId,
      id: installationId,
      hostname: "test host",
      osUser: "tester",
      platform: "linux",
      arch: "x64",
    },
  });
  return fixtures.session({
    organizationId: authority.organizationId,
    userId,
    keyId: key.keyId,
    installationId,
    visibility,
    fields: { title: "Visible header", ...fields },
  });
}
/** One physical row at an explicit revision and generation; publication stays with the test. */
async function row(
  table: TraceTable,
  authority: ReadAuthority,
  id: string,
  revision: bigint,
  generation: bigint,
  fields: Record<string, unknown> = {},
) {
  await fixtures.insertRaw(
    table,
    {
      organizationId: authority.organizationId,
      sessionId: id,
      revision,
      generation,
    },
    {
      ...(table === "messages"
        ? { role: "USER", kind: "TEXT", tool_input: "null" }
        : {}),
      ...fields,
    },
  );
}
async function select(
  authority: ReadAuthority,
  sql: string,
  parameters: Record<string, string> = {},
) {
  return db.traceReaders.read(authority, (client) =>
    client.query(sql, parameters),
  );
}
// @req R-SEC-01 @req R-ORG-03 @req R-RED-01
it("blocks hidden source rows before caller predicates and joins with native optimization enabled", async () => {
  const visible = await seed(owner);
  const hidden = await seed(owner, "PRIVATE");
  const foreign = await seed(other);
  const ids = [visible, hidden, foreign];
  for (const [index, id] of ids.entries())
    await row("messages", index === 2 ? other : owner, id, 1n, 0n, {
      message_id: randomUUID(),
      content: index === 0 ? "safe" : "PRIVATE SECRET",
      tool_input: "null",
      received_at: new Date(),
    });
  const plain = await select(
    member,
    "SELECT content FROM messages WHERE session_id IN ({visible:UUID},{hidden:UUID},{foreign:UUID})",
    { visible, hidden, foreign },
  );
  expect(plain.rows).toEqual([{ content: "safe" }]);
  expect(
    (
      await select(
        member,
        "SELECT session_id FROM message_metadata WHERE session_id IN ({visible:UUID},{hidden:UUID},{foreign:UUID})",
        { visible, hidden, foreign },
      )
    ).rows,
  ).toEqual([{ session_id: visible }]);
  const joined = await select(
    member,
    "SELECT m.content FROM messages m JOIN (SELECT 0 AS value) c ON toUInt64(if(m.content='PRIVATE SECRET',m.content,'0'))=c.value WHERE m.session_id IN ({visible:UUID},{hidden:UUID},{foreign:UUID})",
    { visible, hidden, foreign },
  );
  expect(joined.rows).toEqual([{ content: "safe" }]);
  const predicate = await select(
    member,
    "SELECT content FROM messages WHERE throwIf(content='PRIVATE SECRET')=0 AND session_id IN ({visible:UUID},{hidden:UUID},{foreign:UUID})",
    { visible, hidden, foreign },
  );
  expect(predicate.rows).toEqual([{ content: "safe" }]);
  expect(
    (
      await select(
        owner,
        "SELECT content FROM messages WHERE session_id={hidden:UUID}",
        { hidden },
      )
    ).rows,
  ).toEqual([{ content: "PRIVATE SECRET" }]);
});
// @req R-SEC-01 @req R-ORG-03
it("protects joined user and installation metadata before optimizer pushdown", async () => {
  const visible = await seed(owner);
  const foreign = await seed(other);
  await db.prisma.user.update({
    where: { id: z.string().parse(other.userId) },
    data: { name: "FOREIGN USER SECRET" },
  });
  const foreignControl = await db.prisma.traceSessionControl.findUniqueOrThrow({
    where: {
      organizationId_id: { organizationId: other.organizationId, id: foreign },
    },
  });
  await db.prisma.installation.update({
    where: {
      organizationId_id: {
        organizationId: other.organizationId,
        id: foreignControl.installationId,
      },
    },
    data: { hostname: "FOREIGN HOST SECRET" },
  });
  for (const [column, secret] of [
    ["user_name", "FOREIGN USER SECRET"],
    ["installation_hostname", "FOREIGN HOST SECRET"],
  ] as const) {
    const result = await select(
      member,
      `SELECT s.session_id FROM sessions s JOIN (SELECT 0 AS n)c ON toUInt64(if(s.${column}={secret:String},s.${column},'0'))=c.n WHERE s.session_id={id:UUID}`,
      { id: visible, secret: z.string().parse(secret) },
    );
    expect(result.rows).toEqual([{ session_id: visible }]);
  }
});
// @req R-SEC-01 @req R-SEC-03
it("exposes only lifecycle state without hidden parent columns or predicate access", async () => {
  const parent = await seed(owner, "PRIVATE");
  const child = await seed(owner);
  await db.prisma.traceSessionControl.update({
    where: {
      organizationId_id: { organizationId: owner.organizationId, id: child },
    },
    data: {
      parentSessionId: parent,
      parentRelation: "SUBAGENT",
      parentNativeRef: "hidden-parent-reference",
    },
  });
  const state = await select(
    member,
    "SELECT * FROM api_ro.session_state WHERE session_id={id:UUID}",
    { id: child },
  );
  expect(state.rows).toHaveLength(1);
  expect(Object.keys(state.rows[0] ?? {}).sort()).toEqual([
    "last_activity_at",
    "message_count",
    "session_id",
    "status",
  ]);
  expect(
    (
      await select(
        member,
        "SELECT session_id FROM api_ro.session_state WHERE session_id={id:UUID}",
        { id: parent },
      )
    ).rows,
  ).toEqual([]);
  for (const sql of [
    "SELECT parent_session_id FROM api_ro.session_state",
    "SELECT session_id FROM api_ro.session_state WHERE parent_session_id={id:UUID}",
    "SELECT session_id FROM api_ro.session_state ORDER BY parent_native_ref",
    "SELECT session_id FROM api_ro.session_state s JOIN api_ro.session_base b ON s.session_id=b.session_id WHERE b.parent_session_id={id:UUID}",
    "SELECT session_id FROM api_ro.session_base WHERE parent_session_id={id:UUID}",
  ])
    await expect(select(member, sql, { id: parent })).rejects.toThrow();
  expect(
    (
      await select(
        member,
        "SELECT parent_session_id,parent_relation FROM sessions WHERE session_id={id:UUID}",
        { id: child },
      )
    ).rows,
  ).toEqual([{ parent_session_id: null, parent_relation: null }]);
});
// @req R-RED-08 @req R-ING-04 @req R-SEC-02
it("fences unpublished revisions and every older redaction generation before expression evaluation", async () => {
  const id = await seed(owner);
  const message = randomUUID();
  const raw = randomUUID();
  await row("messages", owner, id, 1n, 0n, {
    message_id: message,
    content: "BEFORE RESCAN",
    tool_input: "null",
    received_at: new Date(),
  });
  await row("messages", owner, id, 2n, 1n, {
    message_id: message,
    content: "[REDACTED]",
    tool_input: "null",
    received_at: new Date(),
  });
  await row("raw_records", owner, id, 1n, 0n, {
    raw_record_id: raw,
    ingest_batch_id: randomUUID(),
    payload: '{"text":"BEFORE RESCAN"}',
    redaction_context: "{}",
    received_at: new Date(),
  });
  await row("raw_records", owner, id, 2n, 1n, {
    raw_record_id: raw,
    ingest_batch_id: randomUUID(),
    payload: '{"text":"[REDACTED]"}',
    redaction_context: "{}",
    received_at: new Date(),
  });
  expect(
    (
      await select(
        owner,
        "SELECT content FROM messages WHERE session_id={id:UUID}",
        { id },
      )
    ).rows,
  ).toEqual([{ content: "BEFORE RESCAN" }]);
  // Copy the current header as a rescan must do before publishing its generation.
  const header = await db.traces.readSession(owner.organizationId, id, 1n, 0n);
  expect(header).not.toBeNull();
  if (!header) throw new Error("Missing test header");
  await db.traces.writeProjection({
    organizationId: owner.organizationId,
    sessionId: id,
    revision: 2n,
    generation: 1n,
    session: header,
    messages: [],
    files: [],
  });
  await db.prisma.$transaction(async (tx) => {
    await lockTracePublication(tx, owner.organizationId, "write");
    await tx.traceSessionControl.update({
      where: {
        organizationId_id: { organizationId: owner.organizationId, id },
      },
      data: {
        acceptedRevision: 2n,
        publishedRevision: 2n,
        redactionGeneration: 1n,
      },
    });
  });
  expect(
    (
      await select(
        owner,
        "SELECT content FROM messages m JOIN (SELECT 0 AS n)c ON toUInt64(if(content='BEFORE RESCAN',content,'0'))=c.n WHERE session_id={id:UUID}",
        { id },
      )
    ).rows,
  ).toEqual([{ content: "[REDACTED]" }]);
  expect(
    (
      await select(
        owner,
        "SELECT payload FROM raw_records WHERE throwIf(position(payload,'BEFORE RESCAN')>0)=0 AND session_id={id:UUID}",
        { id },
      )
    ).rows,
  ).toEqual([{ payload: '{"text":"[REDACTED]"}' }]);
});
// @req R-SEC-01 @req R-MOD-02
it("hides all purged content even from admins while retaining only the control-plane skeleton", async () => {
  const id = await seed(owner);
  await row("messages", owner, id, 1n, 0n, {
    message_id: randomUUID(),
    content: "purged private content",
    tool_input: "null",
    received_at: new Date(),
  });
  await db.prisma.traceSessionControl.update({
    where: { organizationId_id: { organizationId: owner.organizationId, id } },
    data: { purgedAt: new Date() },
  });
  expect(
    (
      await select(
        owner,
        "SELECT content FROM messages WHERE session_id={id:UUID}",
        { id },
      )
    ).rows,
  ).toEqual([]);
  expect(
    (
      await select(
        owner,
        "SELECT title,message_count FROM sessions WHERE session_id={id:UUID}",
        { id },
      )
    ).rows,
  ).toEqual([{ title: null, message_count: 0 }]);
  await db.traces.cleanupSession({
    organizationId: owner.organizationId,
    sessionId: id,
  });
  const physical = await writer.query({
    query:
      "SELECT count() AS count FROM sessions WHERE organization_id={org:String} AND session_id={id:UUID}",
    query_params: { org: owner.organizationId, id },
    format: "JSONEachRow",
  });
  expect(await physical.json()).toEqual([{ count: 0 }]);
  const identities = await writer.query({
    query:
      "SELECT * FROM session_identities FINAL WHERE organization_id={org:String} AND session_id={id:UUID}",
    query_params: { org: owner.organizationId, id },
    format: "JSONEachRow",
  });
  expect(await identities.json()).toEqual([
    { organization_id: owner.organizationId, session_id: id },
  ]);
  expect(
    (
      await select(
        owner,
        "SELECT title,message_count FROM sessions WHERE session_id={id:UUID}",
        { id },
      )
    ).rows,
  ).toEqual([{ title: null, message_count: 0 }]);
  expect(
    (
      await select(
        member,
        "SELECT session_id FROM sessions WHERE session_id={id:UUID}",
        { id },
      )
    ).rows,
  ).toEqual([]);
});
// @req R-SEC-01
it("fails closed for missing controls and refuses raw storage, dictionary and credential discovery", async () => {
  const absent = randomUUID();
  await row("messages", owner, absent, 1n, 0n, {
    message_id: randomUUID(),
    content: "orphan",
    tool_input: "null",
    received_at: new Date(),
  });
  expect(
    (
      await select(
        owner,
        "SELECT content FROM messages WHERE session_id={id:UUID}",
        { id: absent },
      )
    ).rows,
  ).toEqual([]);
  for (const sql of [
    "SELECT * FROM ac_trace.messages",
    "SELECT * FROM ac_trace.session_identities",
    "SELECT * FROM ac_trace.control_installations",
    "SHOW CREATE TABLE ac_trace.control_installations",
    "SELECT dictGet('ac_trace.session_scope','visible',('x',toUUID('00000000-0000-0000-0000-000000000000')))",
  ]) {
    await expect(select(owner, sql)).rejects.toThrow();
  }
  const metadata = await select(
    owner,
    "SELECT create_table_query FROM system.tables WHERE database='ac_trace'",
  );
  expect(metadata.rows).toEqual([]);
});
// @req R-SEC-01
it("re-applies the reader limits to principals an earlier release created", async () => {
  await select(member, "SELECT 1");
  const principal = tracePrincipal(
    member,
    true,
    db.traceConfig.readerSecret,
  ).username;
  const admin = createTraceClient({
    url: db.traceMigration.url,
    username: db.traceMigration.username,
    password: db.traceMigration.password,
  });
  release.unshift(() => admin.close());
  const settings = async () => {
    const result = await admin.query({
      query:
        "SELECT setting_name, value FROM system.settings_profile_elements WHERE user_name={user:String} ORDER BY setting_name",
      query_params: { user: principal },
      format: "JSONEachRow",
    });
    return z
      .array(
        z.object({ setting_name: z.string(), value: z.string().nullable() }),
      )
      .parse(await result.json());
  };
  // A principal an older release provisioned: fewer, looser limits than today's list.
  await admin.command({
    query: `ALTER USER ${sqlIdentifier(principal)} SETTINGS readonly=1, max_execution_time=30`,
  });
  expect(await settings()).toEqual([
    { setting_name: "max_execution_time", value: "30" },
    { setting_name: "readonly", value: "1" },
  ]);
  // A fresh process re-provisions on first use and replaces the whole settings list.
  const readers = new TraceReaders(db.traceConfig, db.prisma, {
    embeddings: true,
  });
  release.unshift(() => readers.close());
  await readers.read(member, (client) => client.query("SELECT 1"));
  const current = await settings();
  expect(current).toContainEqual({
    setting_name: "max_execution_time",
    value: "5",
  });
  expect(current).toContainEqual({ setting_name: "max_threads", value: "2" });
  expect(current).toContainEqual({ setting_name: "readonly", value: "1" });
  expect(current.length).toBeGreaterThan(2);
});
// @req R-ING-01 @req R-SEC-01
it("holds one publication snapshot across callback queries with a three-connection PostgreSQL pool", async () => {
  const id = await seed(owner);
  const message = randomUUID();
  await row("messages", owner, id, 1n, 0n, {
    message_id: message,
    content: "old complete",
    tool_input: "null",
    received_at: new Date(),
  });
  await row("messages", owner, id, 2n, 0n, {
    message_id: message,
    content: "new complete",
    tool_input: "null",
    received_at: new Date(),
  });
  const url = new URL(db.urls.app);
  url.searchParams.set("connection_limit", "3");
  const prisma = new PrismaClient({ datasourceUrl: url.toString() });
  const readers = new TraceReaders(db.traceConfig, prisma, {
    embeddings: false,
  });
  try {
    let enter: () => void = () => undefined;
    let arrivals = 0;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    let proceed: () => void = () => undefined;
    const resumed = new Promise<void>((resolve) => {
      proceed = resolve;
    });
    const read = () =>
      readers.read(owner, async (client) => {
        await client.query(
          "SELECT title FROM sessions WHERE session_id={id:UUID}",
          { id },
        );
        await client.control.traceSessionControl.findUniqueOrThrow({
          where: {
            organizationId_id: { organizationId: owner.organizationId, id },
          },
        });
        if (++arrivals === 2) enter();
        await resumed;
        return client.query(
          "SELECT content FROM messages WHERE session_id={id:UUID}",
          { id },
        );
      });
    const first = read();
    const second = read();
    // Surface a failed initial query instead of leaving the synchronization barrier pending.
    await Promise.race([entered, first, second]);
    let published = false;
    let attempted: () => void = () => undefined;
    const attempt = new Promise<void>((resolve) => {
      attempted = resolve;
    });
    const publication = prisma.$transaction(async (tx) => {
      attempted();
      await lockTracePublication(tx, owner.organizationId, "write");
      await tx.traceSessionControl.update({
        where: {
          organizationId_id: { organizationId: owner.organizationId, id },
        },
        data: { acceptedRevision: 2n, publishedRevision: 2n },
      });
      published = true;
    });
    await attempt;
    expect(published).toBe(false);
    proceed();
    expect((await first).rows).toEqual([{ content: "old complete" }]);
    expect((await second).rows).toEqual([{ content: "old complete" }]);
    await publication;
    expect(
      (
        await readers.read(owner, (client) =>
          client.query(
            "SELECT content FROM messages WHERE session_id={id:UUID}",
            { id },
          ),
        )
      ).rows,
    ).toEqual([{ content: "new complete" }]);
  } finally {
    await readers.close();
    await prisma.$disconnect();
  }
});
// @req R-EMB-01 @req R-EMB-04 @req R-SEC-01
it("enforces native vector opt-in, publication and SaaS entitlement fences with no off-role vector grant", async () => {
  const id = await seed(owner);
  const vector = Array<number>(1024).fill(0);
  vector[0] = 1;
  const scope = {
    organizationId: owner.organizationId,
    sessionId: id,
    revision: 1n,
    generation: 0n,
  };
  await db.traces.writeEmbeddings(scope, {
    chunks: [
      {
        id: randomUUID(),
        messageId: randomUUID(),
        ordinal: 0,
        content: "vector source",
        contentHash: "b".repeat(64),
        model: "text-embedding-3-small",
        tokenCount: 2,
        embedding: vector,
      },
    ],
    session: {
      model: "text-embedding-3-small",
      tokenCount: 2,
      embedding: vector,
    },
    updatedAt: new Date(),
  });
  const count = async (readers: TraceReaders) =>
    readers.read(owner, (client) =>
      client.query(
        "SELECT session_id FROM session_embeddings WHERE session_id={id:UUID}",
        { id },
      ),
    );
  expect((await count(db.traceReaders)).rows).toEqual([]);
  await db.prisma.organizationSettings.upsert({
    where: { organizationId: owner.organizationId },
    create: { organizationId: owner.organizationId, embeddingsEnabled: true },
    update: { embeddingsEnabled: true },
  });
  expect((await count(db.traceReaders)).rows).toEqual([]);
  await db.prisma.traceSessionControl.update({
    where: { organizationId_id: { organizationId: owner.organizationId, id } },
    data: { embeddingRevision: 1n, embeddingSourceRevision: 1n },
  });
  expect((await count(db.traceReaders)).rows).toEqual([{ session_id: id }]);
  const off = new TraceReaders(db.traceConfig, db.prisma, {
    embeddings: false,
  });
  const saas = new TraceReaders(db.traceConfig, db.prisma, {
    embeddings: true,
    saas: true,
  });
  try {
    await expect(count(off)).rejects.toThrow();
    expect((await count(saas)).rows).toEqual([]);
  } finally {
    await off.close();
    await saas.close();
  }
  await db.prisma.traceSessionControl.update({
    where: { organizationId_id: { organizationId: owner.organizationId, id } },
    data: { acceptedRevision: 2n, publishedRevision: 2n },
  });
  expect((await count(db.traceReaders)).rows).toEqual([]);
  await expect(
    db.traces.writeEmbeddings(scope, {
      chunks: [],
      session: {
        model: "text-embedding-3-small",
        tokenCount: 1,
        embedding: [1],
      },
      updatedAt: new Date(),
    }),
  ).rejects.toThrow();
});
// @req R-AUD-02 @req R-SEC-01
it("limits audit source rows to current organization, authorized actor or visible successful get and retention", async () => {
  const id = await seed(owner);
  const otherUser = z.string().parse(other.userId);
  const now = new Date();
  const base = {
    organization_id: owner.organizationId,
    ts: now,
    user_id: otherUser,
    user_email: "other@example.com",
    api_key_id: null,
    installation_id: null,
    auth_method: "key",
    transport: "mcp",
    resource_ids: [id],
    status_code: 200,
    duration_ms: 1,
  };
  const ownId = randomUUID();
  const foreignQuery = randomUUID();
  const readId = randomUUID();
  await db.traces.appendAudit([
    {
      ...base,
      id: ownId,
      user_id: z.string().parse(owner.userId),
      action: "search",
      detail: { input: { query: "own query" } },
    },
    {
      ...base,
      id: foreignQuery,
      action: "search",
      detail: { input: { query: "FOREIGN QUERY SECRET" } },
    },
    { ...base, id: readId, action: "get", detail: {} },
  ]);
  // Direct source access remains denied; use a definer view to exercise the underlying policy.
  const migrator = createTraceClient({
    url: db.traceMigration.url,
    username: db.traceMigration.username,
    password: db.traceMigration.password,
  });
  try {
    await migrator.command({
      query:
        "CREATE VIEW api_ro.audit_policy_test DEFINER=ac_trace_view_owner SQL SECURITY DEFINER AS SELECT audit_id,detail FROM ac_trace.audit_events",
    });
    await migrator.command({
      query: "GRANT SELECT ON api_ro.audit_policy_test TO ac_trace_reader",
    });
    const visible = await select(
      member,
      "SELECT audit_id FROM audit_policy_test a JOIN (SELECT 0 AS n)c ON toUInt64(if(position(detail,'FOREIGN QUERY SECRET')>0,detail,'0'))=c.n WHERE audit_id IN ({own:UUID},{foreign:UUID},{read:UUID}) ORDER BY audit_id",
      { own: ownId, foreign: foreignQuery, read: readId },
    );
    expect(visible.rows.map((row) => row.audit_id).sort()).toEqual(
      [ownId, readId].sort(),
    );
    await db.prisma
      .$executeRaw`UPDATE trace_analytics_retention SET retained_after=${new Date(now.getTime() + 1)} WHERE id=1`;
    expect(
      (
        await select(
          owner,
          "SELECT audit_id FROM audit_policy_test WHERE audit_id={id:UUID}",
          { id: ownId },
        )
      ).rows,
    ).toEqual([]);
  } finally {
    await migrator.close();
  }
});

// @req R-SEC-01 @req R-RED-08
it("never uses a cached permission result when the control dictionary becomes unavailable and never logs failed SQL", async () => {
  const id = await seed(owner);
  await row("messages", owner, id, 1n, 0n, {
    message_id: randomUUID(),
    content: "current permission",
    tool_input: "null",
    received_at: new Date(),
  });
  expect(
    (
      await select(
        member,
        "SELECT content FROM messages WHERE session_id={id:UUID}",
        { id },
      )
    ).rows,
  ).toEqual([{ content: "current permission" }]);
  const purged = await seed(owner, "PRIVATE");
  await db.prisma.traceSessionControl.update({
    where: {
      organizationId_id: { organizationId: owner.organizationId, id: purged },
    },
    data: { purgedAt: new Date() },
  });
  expect(
    (
      await select(
        owner,
        "SELECT title FROM sessions WHERE session_id={id:UUID}",
        { id: purged },
      )
    ).rows,
  ).toEqual([{ title: null }]);
  const migration = new PrismaClient({ datasourceUrl: db.urls.migration });
  try {
    await migration.$executeRawUnsafe(
      "REVOKE SELECT ON trace_control.session_scope FROM ac_trace_control",
    );
    await expect(
      select(
        member,
        "SELECT content FROM messages WHERE session_id={id:UUID}",
        { id },
      ),
    ).rejects.toThrow();
    await expect(
      select(owner, "SELECT title FROM sessions WHERE session_id={id:UUID}", {
        id: purged,
      }),
    ).rejects.toThrow();
  } finally {
    await migration.$executeRawUnsafe(
      "GRANT SELECT ON trace_control.session_scope TO ac_trace_control",
    );
    await migration.$disconnect();
  }
  expect(
    (
      await select(
        member,
        "SELECT content FROM messages WHERE session_id={id:UUID}",
        { id },
      )
    ).rows,
  ).toEqual([{ content: "current permission" }]);
  const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  try {
    await expect(
      select(member, "SELECT toUInt64('SQL_VALUE_MUST_NOT_BE_LOGGED')"),
    ).rejects.toThrow();
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    const logs = await db.traceContainer.exec([
      "sh",
      "-c",
      "cat /var/log/clickhouse-server/*.log 2>/dev/null || true",
    ]);
    expect(logs.output).not.toContain("SQL_VALUE_MUST_NOT_BE_LOGGED");
  } finally {
    error.mockRestore();
    warn.mockRestore();
    log.mockRestore();
  }
});
// @req R-EMB-02 @req R-ING-04 @req R-RED-08
it("retries native vector writes, pages reusable chunks, tombstones removed chunks and physically retires old generations", async () => {
  const id = await seed(owner);
  const scope = {
    organizationId: owner.organizationId,
    sessionId: id,
    revision: 1n,
    generation: 0n,
  };
  const vector = Array<number>(1024).fill(0);
  vector[0] = 1;
  const chunks = [
    {
      id: randomUUID(),
      messageId: randomUUID(),
      ordinal: 0,
      content: "first source",
      contentHash: "c".repeat(64),
      tokenCount: 2,
      model: "text-embedding-3-small",
      embedding: vector,
    },
    {
      id: randomUUID(),
      messageId: randomUUID(),
      ordinal: 1,
      content: "second source",
      contentHash: "d".repeat(64),
      tokenCount: 2,
      model: "text-embedding-3-small",
      embedding: vector,
    },
  ];
  const input = {
    chunks,
    session: {
      model: "text-embedding-3-small",
      tokenCount: 4,
      embedding: vector,
    },
    updatedAt: new Date(),
  };
  await db.traces.writeEmbeddings(scope, { ...input, session: null });
  expect(await db.traces.readSessionEmbedding(scope)).toBeNull();
  await db.traces.writeEmbeddings(scope, input);
  await db.traces.writeEmbeddings(scope, input);
  expect(await db.traces.readSessionEmbedding(scope)).toMatchObject({
    model: input.session.model,
    tokenCount: 4,
  });
  const first = await db.traces.embeddingsPage(scope, {
    after: null,
    limit: 1,
  });
  expect(first.items).toHaveLength(1);
  const second = await db.traces.embeddingsPage(scope, {
    after: first.after,
    limit: 1,
  });
  expect(second.items).toHaveLength(1);
  expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
  expect(
    (await db.traces.embeddingsPage(scope, { after: second.after, limit: 1 }))
      .items,
  ).toEqual([]);
  const messageId = randomUUID();
  await row("messages", owner, id, 1n, 0n, {
    message_id: messageId,
    role: "ASSISTANT",
    kind: "TEXT",
    content: "canonical derived source",
    search_text: "canonical derived source",
    searchable: true,
    tool_input: "null",
    received_at: new Date(),
    input_tokens: "9007199254740993",
  });
  const messages = await db.traces.messagesPage(scope, {
    after: null,
    limit: 1,
  });
  expect(messages.items[0]).toMatchObject({
    id: messageId,
    role: "ASSISTANT",
    input_tokens: 9007199254740993n,
    tool_input: null,
  });
  expect(
    (await db.traces.messagesPage(scope, { after: messages.after, limit: 1 }))
      .items,
  ).toEqual([]);
  const retained = chunks.slice(1);
  const revision = { ...scope, revision: 2n };
  expect(await db.traces.readSessionEmbedding(revision)).toBeNull();
  await db.traces.writeEmbeddings(revision, { ...input, chunks: retained });
  expect(
    (
      await db.traces.embeddingsPage(revision, { after: null, limit: 100 })
    ).items.map((value) => value.id),
  ).toEqual(retained.map((value) => value.id));
  const next = { ...scope, revision: 3n, generation: 1n };
  await db.traces.writeEmbeddings(next, { ...input, chunks: retained });
  await db.prisma.traceSessionControl.update({
    where: { organizationId_id: { organizationId: owner.organizationId, id } },
    data: {
      acceptedRevision: 3n,
      publishedRevision: 3n,
      redactionGeneration: 1n,
    },
  });
  await db.traces.cleanupGenerations(next);
  await db.traces.cleanupGenerations(next);
  expect(
    (await db.traces.embeddingsPage(scope, { after: null, limit: 100 })).items,
  ).toEqual([]);
  expect(
    (
      await db.traces.embeddingsPage(next, { after: null, limit: 100 })
    ).items.map((value) => value.id),
  ).toEqual(retained.map((value) => value.id));
  await db.traces.cleanupSession(scope);
  expect(await db.traces.sessionCounts(scope)).toEqual({
    raw_records: 0,
    messages: 0,
    session_files: 0,
    message_chunks: 0,
    session_embeddings: 0,
  });
});

// @req R-SEC-01
it("preserves required PostgreSQL TLS for native engines and direct dictionaries", async () => {
  const admin = createTraceClient({
    url: db.traceMigration.url,
    username: db.traceMigration.username,
    password: db.traceMigration.password,
  });
  const pg = new URL(db.traceMigration.postgresControlUrl);
  pg.searchParams.set("sslmode", "require");
  const table = `ac_trace.tls_engine_${randomUUID().replaceAll("-", "")}`;
  const dictionary = `ac_trace.tls_dictionary_${randomUUID().replaceAll("-", "")}`;
  try {
    // The fixture deliberately has no TLS. Required TLS must fail instead of silently
    // falling back to the successful plaintext control connections used elsewhere.
    const engine = async () => {
      await admin.command({
        query: `CREATE TABLE ${table} (organization_id String) ${postgresSourceSql(pg.toString(), "organization_settings", "engine")}`,
      });
      await (
        await admin.query({
          query: `SELECT * FROM ${table}`,
          format: "JSONEachRow",
        })
      ).json();
    };
    await expect(engine()).rejects.toThrow(/SSL|TLS/i);
    const direct = async () => {
      await admin.command({
        query: `CREATE DICTIONARY ${dictionary} (organization_id String,embeddings_enabled Int32 DEFAULT 0) PRIMARY KEY organization_id ${postgresSourceSql(pg.toString(), "organization_settings", "dictionary")} LAYOUT(COMPLEX_KEY_DIRECT())`,
      });
      await (
        await admin.query({
          query: `SELECT dictGet(${sqlString(dictionary)},'embeddings_enabled',tuple('missing'))`,
          format: "JSONEachRow",
        })
      ).json();
    };
    await expect(direct()).rejects.toThrow(/SSL|TLS/i);
  } finally {
    await admin.command({ query: `DROP TABLE IF EXISTS ${table}` });
    await admin.command({ query: `DROP DICTIONARY IF EXISTS ${dictionary}` });
    await admin.close();
  }
});

// @req R-DASH-13 @req R-SEC-01
it("executes composed native analytics without exhausting eager PostgreSQL control sources", async () => {
  const id = await seed(owner);
  const auditId = randomUUID();
  await db.traces.appendAudit([
    {
      id: auditId,
      organization_id: owner.organizationId,
      ts: new Date(),
      user_id: z.string().parse(owner.userId),
      user_email: "metrics@example.com",
      api_key_id: null,
      installation_id: null,
      auth_method: "cookie",
      transport: "rest",
      action: "search",
      resource_ids: [id],
      status_code: 200,
      duration_ms: 1,
      detail: { input: { query: "visible" }, result: { hits: 1 } },
    },
  ]);
  // SELECT * deliberately retains follow-through, attribution and result metadata;
  // selecting only a count would allow the optimizer to prune the failing branches.
  const result = await db.traceReaders.read(owner, (client) =>
    client.query("SELECT * FROM metrics_usage WHERE id={id:UUID}", {
      id: auditId,
    }),
  );
  expect(result.rows).toMatchObject([
    { id: auditId, action: "search", hits: "1" },
  ]);
});

// @req R-SEC-03
it("derives parent metadata, child counts, repositories and installations only from visible sessions", async () => {
  const repo = `visibility-${randomUUID()}`;
  const hiddenParent = await seed(owner, "PRIVATE", {
    repo_name: repo,
    title: "Hidden parent title",
  });
  const publicChild = await seed(owner, "PUBLIC", { repo_name: repo });
  const publicParent = await seed(owner, "PUBLIC", { repo_name: repo });
  const hiddenChild = await seed(owner, "PRIVATE", { repo_name: repo });
  for (const [id, parentSessionId] of [
    [publicChild, hiddenParent],
    [hiddenChild, publicParent],
  ] as const) {
    await db.prisma.traceSessionControl.update({
      where: {
        organizationId_id: { organizationId: owner.organizationId, id },
      },
      data: { parentSessionId, parentRelation: "SPAWNED" },
    });
  }
  const parameters = { child: publicChild, parent: publicParent, repo };
  const memberRows = (
    await select(
      member,
      "SELECT session_id,parent_title,child_count FROM session_details WHERE session_id IN ({child:UUID},{parent:UUID})",
      parameters,
    )
  ).rows;
  expect(memberRows).toHaveLength(2);
  expect(
    memberRows.find((value) => value.session_id === publicChild)?.parent_title,
  ).toBeNull();
  expect(
    Number(
      memberRows.find((value) => value.session_id === publicParent)
        ?.child_count,
    ),
  ).toBe(0);
  const adminRows = (
    await select(
      owner,
      "SELECT session_id,parent_title,child_count FROM session_details WHERE session_id IN ({child:UUID},{parent:UUID})",
      parameters,
    )
  ).rows;
  expect(
    adminRows.find((value) => value.session_id === publicChild)?.parent_title,
  ).toBe("Hidden parent title");
  expect(
    Number(
      adminRows.find((value) => value.session_id === publicParent)?.child_count,
    ),
  ).toBe(1);
  for (const [authority, expected] of [
    [member, 2],
    [owner, 4],
  ] as const) {
    const repos = await select(
      authority,
      "SELECT session_count FROM repos WHERE repo_name={repo:String}",
      { repo },
    );
    expect(Number(repos.rows[0]?.session_count)).toBe(expected);
    const installations = await select(
      authority,
      "SELECT installation_id FROM installations WHERE installation_id IN (SELECT installation_id FROM session_details WHERE repo_name={repo:String})",
      { repo },
    );
    expect(installations.rows).toHaveLength(expected);
  }
});

// @req R-SQL-05 @req R-DASH-22
it("discovers actual native columns with catalog descriptions and migration-added descriptions without rebuilding the catalog", async () => {
  const native = createTraceClient({
    url: db.traceMigration.url,
    username: db.traceMigration.username,
    password: db.traceMigration.password,
  });
  const columns = (
    await select(
      other,
      "SELECT view_name,column_name,data_type,ordinal_position,description FROM schema_columns",
    )
  ).rows;
  expect(
    [...new Set(columns.map((column) => column.view_name))].sort(),
  ).toEqual([...traceViews].sort());
  for (const column of columns) {
    expect(column.data_type).toEqual(expect.any(String));
    expect(Number(column.ordinal_position)).toBeGreaterThan(0);
    expect(String(column.description).length).toBeGreaterThan(0);
  }
  const functions = (
    await select(
      other,
      "SELECT function_name,arguments,result_type,description FROM schema_functions",
    )
  ).rows;
  expect(functions).toHaveLength(1);
  expect(functions[0]).toMatchObject({
    function_name: "search_messages",
    arguments: "q=String",
    result_type: "session_id UUID, seq UInt32, rank Float64",
  });
  // The shared catalog names exactly the native columns of every canonical and embeddings
  // view, every visible column carries its catalog meaning, and the assistant reference
  // built from the real schema stays prompt-sized.
  const meanings = new Map(
    traceColumnDescriptions().map((row) => [
      `${row.view}.${row.column}`,
      row.description,
    ]),
  );
  const nativeColumns = z
    .array(z.object({ view_name: z.string(), column_name: z.string() }))
    .parse(
      await (
        await native.query({
          query: `SELECT table AS view_name,name AS column_name FROM system.columns WHERE database='api_ro' AND table IN (${[...traceViews, ...traceEmbeddingViews].map(sqlString).join(",")})`,
          format: "JSONEachRow",
        })
      ).json(),
    );
  expect(
    nativeColumns
      .map((column) => `${column.view_name}.${column.column_name}`)
      .sort(),
  ).toEqual([...meanings.keys()].sort());
  const reference = schemaOutputSchema.parse({ columns, functions });
  for (const column of reference.columns)
    expect(column.description).toBe(
      meanings.get(`${column.view_name}.${column.column_name}`),
    );
  const briefing = formatSchemaContext(reference);
  expect(briefing).toContain("# AgentCommons schema reference");
  expect(briefing).toContain("### metrics_own_zero_results");
  expect(new TextEncoder().encode(briefing).length).toBeLessThan(28 * 1024);
  const definition = await native.query({
    query: "SHOW CREATE TABLE api_ro.session_tools",
    format: "JSONEachRow",
  });
  const original = z
    .array(z.object({ statement: z.string() }))
    .parse(await definition.json())[0]?.statement;
  if (!original) throw new Error("Native view definition missing.");
  try {
    await native.command({
      query:
        "CREATE OR REPLACE VIEW api_ro.session_tools (organization_id String,session_id UUID,tool_name String,native_probe UInt32 COMMENT 'Migration-provided description') DEFINER=ac_trace_view_owner SQL SECURITY DEFINER AS SELECT organization_id,session_id,arrayJoin(tools_used) AS tool_name,toUInt32(7) AS native_probe FROM api_ro.session_base",
    });
    expect(
      (
        await select(
          other,
          "SELECT column_name,data_type,ordinal_position,description FROM schema_columns WHERE view_name='session_tools' AND column_name='native_probe'",
        )
      ).rows,
    ).toEqual([
      {
        column_name: "native_probe",
        data_type: "UInt32",
        ordinal_position: 4,
        description: "Migration-provided description",
      },
    ]);
  } finally {
    await native.command({
      query: original.replace(/^CREATE VIEW /, "CREATE OR REPLACE VIEW "),
    });
    await native.close();
  }
  expect(
    (
      await select(
        other,
        "SELECT column_name FROM schema_columns WHERE view_name='session_tools' AND column_name='native_probe'",
      )
    ).rows,
  ).toEqual([]);
});

// @req R-SQL-06
it("keeps the native lexical relation uncapped beyond 500 rows and composes predicates after matching", async () => {
  const visible = await seed(owner);
  const hidden = await seed(owner, "PRIVATE");
  const values = Array.from({ length: 617 }, (_, index) =>
    validateTraceRow("messages", {
      ...emptyTraceRow("messages"),
      organization_id: owner.organizationId,
      session_id: index < 600 ? visible : hidden,
      message_id: randomUUID(),
      seq: index < 600 ? index : index - 600,
      role: "USER",
      kind: "TEXT",
      content: "uncappedcatalogmarker",
      search_text: "uncappedcatalogmarker",
      searchable: true,
      tool_input: "null",
      revision: 1n,
      generation: 0n,
      deleted: 0,
      fingerprint: "a".repeat(64),
    }),
  );
  await writer.insert({
    table: "ac_trace.messages",
    values,
    format: "JSONEachRow",
  });
  const matches = await select(
    member,
    "SELECT session_id,seq,rank FROM search_messages(q='uncappedcatalogmarker') ORDER BY seq",
  );
  expect(matches.rows).toHaveLength(600);
  expect(new Set(matches.rows.map((message) => message.session_id))).toEqual(
    new Set([visible]),
  );
  expect(matches.rows[599]?.seq).toBe(599);
  expect(Number(matches.rows[599]?.rank)).toBeGreaterThan(0);
  const filtered = await select(
    member,
    "SELECT count() AS count,min(seq) AS first,max(seq) AS last FROM search_messages(q='uncappedcatalogmarker') WHERE seq>=550",
  );
  expect(
    filtered.rows.map((row) => ({
      count: Number(row.count),
      first: Number(row.first),
      last: Number(row.last),
    })),
  ).toEqual([{ count: 50, first: 550, last: 599 }]);
});

// @req R-SRCH-02
it("uses the shared standard-function text index on 100000 rows and matches inflected search terms", async () => {
  const native = createTraceClient({
    url: db.traceMigration.url,
    username: db.traceMigration.username,
    password: db.traceMigration.password,
  });
  const table = `ac_trace.index_probe_${randomUUID().replaceAll("-", "")}`;
  const terms = searchTermsSql("search_text");
  try {
    const indexes = await native.query({
      query:
        "SELECT expr FROM system.data_skipping_indices WHERE database='ac_trace' AND table='messages' AND name='message_terms'",
      format: "JSONEachRow",
    });
    const definition = z
      .array(z.object({ expr: z.string() }))
      .parse(await indexes.json());
    expect(definition).toHaveLength(1);
    // ClickHouse Cloud locks experimental NLP functions off; the index must not need them.
    expect(definition[0]?.expr).not.toContain("stem(");
    expect(definition[0]?.expr).toContain("replaceRegexpOne(");
    expect(definition[0]?.expr).toContain("lowerUTF8(search_text)");
    const inflections = await native.query({
      query: `SELECT ${searchTermsSql("{inflected:String}")} AS inflected,${searchTermsSql("{base:String}")} AS base`,
      query_params: {
        inflected:
          "Libraries caching Policies committed expirations boundaries agreed indexes deployed TS2322 libssl.so.3 pending-batch.json",
        base: "library cached policy commit expiration boundary agree index deploy TS2322 libssl.so.3 pending-batch.json",
      },
      format: "JSONEachRow",
    });
    const [normalized] = z
      .array(z.object({ inflected: z.string(), base: z.string() }))
      .parse(await inflections.json());
    expect(normalized?.inflected).toBe(normalized?.base);
    expect(normalized?.base).toContain("ts2322 libssl so 3 pend batch json");
    await native.command({
      query: `CREATE TABLE ${table} (id UInt64,revision Int64,search_text String,INDEX message_terms ${terms} TYPE text(tokenizer=splitByNonAlpha)) ENGINE=ReplacingMergeTree ORDER BY (id,revision)`,
    });
    await native.command({
      query: `INSERT INTO ${table} SELECT number,1,if(number%1000=0,'raresttoken running tests',concat('ordinary text ',toString(number))) FROM numbers(100000)`,
    });
    const query = `SELECT id FROM ${table} FINAL WHERE hasAllTokens(${terms},(SELECT ${searchTermsSql("'raresttoken runs'")}))`;
    const explanation = await native.query({
      query: `EXPLAIN indexes=1 ${query}`,
      format: "JSONEachRow",
    });
    const plan = z
      .array(z.object({ explain: z.string() }))
      .parse(await explanation.json())
      .map((value) => value.explain)
      .join("\n");
    expect(plan).toContain("Name: message_terms");
    expect(plan).toContain("__text_index_message_terms");
    const result = await native.query({ query, format: "JSONEachRow" });
    const matches = z
      .array(
        z.object({ id: z.union([z.string(), z.number()]).transform(Number) }),
      )
      .parse(await result.json());
    expect(matches.map((value) => value.id).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 100 }, (_, index) => index * 1000),
    );
    // The native plan may retain every granule: index execution is not a pruning or capacity claim.
  } finally {
    try {
      await native.command({ query: `DROP TABLE IF EXISTS ${table}` });
    } finally {
      await native.close();
    }
  }
});

// @req R-SEC-01 @req R-GET-01
it("completes five concurrent full session reads and a fifteen-reader burst without exhausting native control sources", async () => {
  for (let index = 0; index < 56; index++) await seed(owner);
  const purged = await seed(owner, "PRIVATE", {
    title: "Purged content must stay hidden",
  });
  await db.prisma.traceSessionControl.update({
    where: {
      organizationId_id: { organizationId: owner.organizationId, id: purged },
    },
    data: { purgedAt: new Date() },
  });
  for (const count of [5, 15]) {
    const pages = await Promise.all(
      Array.from({ length: count }, () =>
        select(owner, "SELECT * FROM sessions ORDER BY session_id"),
      ),
    );
    const ids = pages[0]?.rows.map((row) => row.session_id);
    expect(ids?.length).toBeGreaterThanOrEqual(57);
    for (const page of pages) {
      expect(page.rows.map((row) => row.session_id)).toEqual(ids);
      expect(page.rows.find((row) => row.session_id === purged)).toMatchObject({
        title: null,
        first_prompt: null,
        tools_used: [],
      });
    }
  }
});

// @req R-AUD-05 @req R-GET-04 @req R-SEC-01 @req R-DASH-42
it("serves the reuse relations from stored session reads under organization, visibility, purge and retention fences", async () => {
  const source = await seed(owner);
  const target = await seed(owner);
  const hidden = await seed(owner, "PRIVATE");
  const foreignSource = await seed(other);
  const foreignTarget = await seed(other);
  const at = Date.now();
  const minute = (offset: number) => new Date(at + offset * 60_000);
  const read = (
    authority: ReadAuthority,
    sessionId: string,
    targetId: string,
    offset: number,
    action = "get",
  ) => ({
    organization_id: authority.organizationId,
    session_id: sessionId,
    audit_id: randomUUID(),
    read_at: minute(offset),
    action,
    target_session_id: targetId,
    reader_user_id: z.string().parse(authority.userId),
    reader_email: "reader@example.com",
    reader_harness: "CODEX",
  });
  await db.traces.appendSessionReads([
    read(owner, source, target, 0),
    read(owner, source, target, 5),
    read(owner, source, hidden, 6),
    // A self read and a search mark the session memory-assisted but are no edge.
    read(owner, source, source, 2),
    read(owner, source, NO_TARGET_SESSION_ID, 3, "search"),
    read(other, foreignSource, foreignTarget, 0),
  ]);
  const edges = async (authority: ReadAuthority) =>
    (
      await select(
        authority,
        "SELECT source_session_id,target_session_id FROM reuse_edges ORDER BY read_at",
      )
    ).rows;
  const edge = (source_session_id: string, target_session_id: string) => ({
    source_session_id,
    target_session_id,
  });
  const reuseCount = async (authority: ReadAuthority, id: string) =>
    (
      await select(
        authority,
        "SELECT reuse_count FROM sessions WHERE session_id={id:UUID}",
        { id },
      )
    ).rows;
  // The reading side of the same rows: search/sql calls and distinct sessions read.
  const usage = async (authority: ReadAuthority, id: string) =>
    (
      await select(
        authority,
        "SELECT agentcommons_search_calls,reuses_made FROM sessions WHERE session_id={id:UUID}",
        { id },
      )
    ).rows;
  const flags = async (authority: ReadAuthority, id: string) =>
    (
      await select(
        authority,
        "SELECT reused,memory_assisted FROM metrics_reuse_sessions WHERE session_id={id:UUID}",
        { id },
      )
    ).rows;
  expect(await edges(owner)).toEqual([
    edge(source, target),
    edge(source, target),
    edge(source, hidden),
  ]);
  expect(await edges(member)).toEqual([
    edge(source, target),
    edge(source, target),
  ]);
  expect(await edges(other)).toEqual([edge(foreignSource, foreignTarget)]);
  const reuse = await select(
    owner,
    "SELECT reuse_count,unique_readers,cross_user_reuse_count,last_reused_at FROM session_reuse WHERE session_id={id:UUID}",
    { id: target },
  );
  const reused = z
    .tuple([
      z.object({
        reuse_count: z.string(),
        unique_readers: z.string(),
        cross_user_reuse_count: z.string(),
        last_reused_at: z.coerce.date(),
      }),
    ])
    .parse(reuse.rows)[0];
  expect(reused).toMatchObject({
    reuse_count: "1",
    unique_readers: "1",
    cross_user_reuse_count: "0",
  });
  expect(reused.last_reused_at.getTime()).toBe(minute(5).getTime());
  expect(await reuseCount(owner, target)).toEqual([{ reuse_count: "1" }]);
  expect(await reuseCount(owner, hidden)).toEqual([{ reuse_count: "1" }]);
  expect(await reuseCount(owner, source)).toEqual([{ reuse_count: "0" }]);
  expect(await reuseCount(member, hidden)).toEqual([]);
  // One search and three distinct targets, of which the self read is no reuse and the
  // hidden target counts for admins only; the read sessions themselves did neither.
  expect(await usage(owner, source)).toEqual([
    { agentcommons_search_calls: "1", reuses_made: "2" },
  ]);
  expect(await usage(member, source)).toEqual([
    { agentcommons_search_calls: "1", reuses_made: "1" },
  ]);
  expect(await usage(owner, target)).toEqual([
    { agentcommons_search_calls: "0", reuses_made: "0" },
  ]);
  expect(await usage(other, foreignSource)).toEqual([
    { agentcommons_search_calls: "0", reuses_made: "1" },
  ]);
  expect(await flags(owner, source)).toEqual([
    { reused: 1, memory_assisted: 1 },
  ]);
  expect(await flags(owner, target)).toEqual([
    { reused: 0, memory_assisted: 0 },
  ]);
  expect(await flags(member, source)).toEqual([
    { reused: 1, memory_assisted: null },
  ]);
  // Purging the read session drops its edges for everyone, admins included.
  await db.prisma.traceSessionControl.update({
    where: {
      organizationId_id: { organizationId: owner.organizationId, id: target },
    },
    data: { purgedAt: new Date() },
  });
  expect(await edges(owner)).toEqual([edge(source, hidden)]);
  expect(await reuseCount(owner, target)).toEqual([{ reuse_count: "0" }]);
  expect(await usage(owner, source)).toEqual([
    { agentcommons_search_calls: "1", reuses_made: "1" },
  ]);
  expect(
    (
      await select(
        owner,
        "SELECT session_id FROM session_reuse WHERE session_id={id:UUID}",
        { id: target },
      )
    ).rows,
  ).toEqual([]);
  // The audit retention cutoff bounds reuse history the way it bounds audit rows.
  const retention = await db.prisma.traceAnalyticsRetention.findUniqueOrThrow({
    where: { id: 1 },
  });
  try {
    await db.prisma.traceAnalyticsRetention.update({
      where: { id: 1 },
      data: { retainedAfter: minute(7) },
    });
    expect(await edges(owner)).toEqual([]);
    expect(await flags(owner, source)).toEqual([
      { reused: 0, memory_assisted: 0 },
    ]);
    expect(await usage(owner, source)).toEqual([
      { agentcommons_search_calls: "0", reuses_made: "0" },
    ]);
  } finally {
    await db.prisma.traceAnalyticsRetention.update({
      where: { id: 1 },
      data: { retainedAfter: retention.retainedAfter },
    });
  }
});

/**
 * The ADR 0047 caller policies as shipped before ADR 0062, kept literally as the oracle of
 * the differential test below: one direct-dictionary `dictGet` per scanned row.
 */
function legacyScopePolicies(): string[] {
  const lookup = `dictGet('ac_trace.session_scope',('published_revision','visible','purged','embedding_revision','embeddings_enabled','paid_embeddings','redaction_generation','embedding_source_revision'),(organization_id,session_id))`;
  const organization = `organization_id=${traceScopeSql.organization}`;
  const retention = `dictGet('ac_trace.audit_retention','retained_after',toUInt64(1))`;
  const policy = (table: string, predicate: string) =>
    `CREATE ROW POLICY OR REPLACE trace_scope ON ac_trace.${table} USING ${predicate} TO ac_trace_view_owner`;
  const visibleSession = (column: string) => {
    const scope = `dictGet('ac_trace.session_scope',('published_revision','visible','purged'),(organization_id,${column}))`;
    return `tupleElement(${scope},1)>0 AND (${traceScopeSql.admin} OR tupleElement(${scope},2)=1) AND tupleElement(${scope},3)=0`;
  };
  const target = `dictGet('ac_trace.session_scope',('published_revision','visible'),(organization_id,toUUIDOrZero(arrayElement(resource_ids,1))))`;
  return [
    policy(
      "session_identities",
      `${organization} AND ${traceScopeSql.admin} AND tupleElement(${lookup},1)>0 AND tupleElement(${lookup},3)=1`,
    ),
    ...Object.entries(traceTables).map(([table, { vector }]) =>
      policy(
        table,
        `${organization} AND generation=tupleElement(${lookup},7) AND revision>0 AND ${vector ? `revision=tupleElement(${lookup},4)` : `revision<=tupleElement(${lookup},1)`} AND (${traceScopeSql.admin} OR tupleElement(${lookup},2)=1) AND tupleElement(${lookup},3)=0${vector ? ` AND ${traceScopeSql.embeddings} AND tupleElement(${lookup},8)=tupleElement(${lookup},1) AND revision<=tupleElement(${lookup},4) AND tupleElement(${lookup},5)=1 AND (NOT ${traceScopeSql.saas} OR tupleElement(${lookup},6)=1)` : ""}`,
      ),
    ),
    policy(
      "control_metrics_health",
      `${organization} AND ${traceScopeSql.admin} AND tupleElement(${lookup},1)>0`,
    ),
    policy(
      "audit_events",
      `${organization} AND ts>=${retention} AND (${traceScopeSql.admin} OR user_id=${traceScopeSql.user} OR (action='get' AND status_code<400 AND tupleElement(${target},1)>0 AND tupleElement(${target},2)=1))`,
    ),
    policy(
      SESSION_READS_TABLE,
      `${organization} AND read_at>=${retention} AND ${visibleSession("session_id")} AND (target_session_id=toUUID('${NO_TARGET_SESSION_ID}') OR ${visibleSession("target_session_id")})`,
    ),
  ];
}
// @req R-SEC-02 @req R-SEC-01 @req R-EMB-04 @req R-AUD-02 @req R-AUD-05
it("shows every principal exactly the rows the per-row dictionary policies showed, table by table", async () => {
  const ownerUser = z.string().parse(owner.userId);
  const otherUser = z.string().parse(other.userId);
  const worker: ReadAuthority = {
    organizationId: owner.organizationId,
    userId: "worker",
    role: "owner",
    permissions: { sessions: ["read"], admin: ["*"] },
    authMethod: "key",
  };
  const sessions = {
    public: await seed(owner),
    target: await seed(owner),
    private: await seed(owner, "PRIVATE"),
    purged: await seed(owner),
    rescanned: await seed(owner),
    vector: await seed(owner),
    staleVector: await seed(owner),
    foreign: await seed(other),
    foreignPrivate: await seed(other, "PRIVATE"),
  };
  const foreignIds: string[] = [sessions.foreign, sessions.foreignPrivate];
  const organizationOf = (id: string) =>
    foreignIds.includes(id) ? other.organizationId : owner.organizationId;
  const control = (
    id: string,
    data: Parameters<typeof db.prisma.traceSessionControl.update>[0]["data"],
  ) =>
    db.prisma.traceSessionControl.update({
      where: { organizationId_id: { organizationId: organizationOf(id), id } },
      data,
    });
  await control(sessions.purged, {
    purgedAt: new Date(),
    purgedByUserId: ownerUser,
  });
  // A rescan published generation 1 as revision 2; its generation 0 rows became stale.
  await control(sessions.rescanned, {
    redactionGeneration: 1n,
    acceptedRevision: 2n,
    publishedRevision: 2n,
  });
  await db.prisma.organizationSettings.upsert({
    where: { organizationId: owner.organizationId },
    create: { organizationId: owner.organizationId, embeddingsEnabled: true },
    update: { embeddingsEnabled: true },
  });
  await control(sessions.vector, {
    embeddingRevision: 1n,
    embeddingSourceRevision: 1n,
  });
  // A completed epoch whose source is not the published revision stays hidden.
  await control(sessions.staleVector, {
    embeddingRevision: 1n,
    embeddingSourceRevision: 0n,
  });
  const embedding = Array<number>(1024).fill(0);
  embedding[0] = 1;
  const inserted: Array<{
    table: TraceTable;
    session: string;
    identity: string;
    generation: bigint;
    revision: bigint;
  }> = [];
  const insert = async (
    table: TraceTable,
    session: string,
    revision: bigint,
    generation: bigint,
  ) => {
    const { identity, identityType, vector } = traceTables[table];
    const value =
      identity === "session_id"
        ? session
        : identityType === "UUID"
          ? randomUUID()
          : `${table}-${String(inserted.length)}`;
    await row(
      table,
      foreignIds.includes(session) ? other : owner,
      session,
      revision,
      generation,
      {
        ...(identity === "session_id" ? {} : { [identity]: value }),
        ...(vector ? { embedding } : {}),
      },
    );
    inserted.push({ table, session, identity: value, generation, revision });
  };
  for (const table of Object.keys(traceTables) as TraceTable[])
    for (const session of Object.values(sessions)) {
      // `seed` already published the session header at revision 1.
      if (table === "sessions")
        inserted.push({
          table,
          session,
          identity: session,
          generation: 0n,
          revision: 1n,
        });
      else await insert(table, session, 1n, 0n);
      await insert(table, session, 2n, 0n);
      if (session === sessions.rescanned) await insert(table, session, 2n, 1n);
    }
  const now = new Date();
  const cutoff = new Date(now.getTime() - 86_400_000);
  const stale = new Date(cutoff.getTime() - 3_600_000);
  const retention = await db.prisma.traceAnalyticsRetention.findUniqueOrThrow({
    where: { id: 1 },
  });
  await db.prisma.traceAnalyticsRetention.update({
    where: { id: 1 },
    data: { retainedAfter: cutoff },
  });
  const audit = (fields: Partial<TraceAudit>): TraceAudit => ({
    id: randomUUID(),
    organization_id: owner.organizationId,
    ts: now,
    user_id: otherUser,
    user_email: "other@example.com",
    api_key_id: null,
    installation_id: null,
    auth_method: "key",
    transport: "mcp",
    action: "get",
    resource_ids: [sessions.public],
    status_code: 200,
    duration_ms: 1,
    detail: {},
    ...fields,
  });
  const audits = {
    own: audit({ user_id: ownerUser, action: "search", resource_ids: [] }),
    publicGet: audit({}),
    privateGet: audit({ resource_ids: [sessions.private] }),
    purgedGet: audit({ resource_ids: [sessions.purged] }),
    failedGet: audit({ status_code: 403 }),
    search: audit({ action: "search", resource_ids: [] }),
    stale: audit({ user_id: ownerUser, ts: stale }),
    foreign: audit({
      organization_id: other.organizationId,
      resource_ids: [sessions.foreign],
    }),
  };
  await db.traces.appendAudit(Object.values(audits));
  const read = (
    session: string,
    target: string,
    fields: Partial<TraceSessionRead> = {},
  ): TraceSessionRead => ({
    organization_id: organizationOf(session),
    session_id: session,
    audit_id: randomUUID(),
    read_at: now,
    action: "get",
    target_session_id: target,
    reader_user_id: otherUser,
    reader_email: "reader@example.com",
    reader_harness: "CODEX",
    ...fields,
  });
  const reads = {
    publicToTarget: read(sessions.public, sessions.target),
    privateSource: read(sessions.private, sessions.target),
    privateTarget: read(sessions.public, sessions.private),
    purgedTarget: read(sessions.public, sessions.purged),
    search: read(sessions.public, NO_TARGET_SESSION_ID, { action: "search" }),
    stale: read(sessions.public, sessions.target, { read_at: stale }),
    foreign: read(sessions.foreign, sessions.foreignPrivate),
  };
  await db.traces.appendSessionReads(Object.values(reads));
  const unentitled = new TraceReaders(db.traceConfig, db.prisma, {
    embeddings: false,
  });
  const saas = new TraceReaders(db.traceConfig, db.prisma, {
    embeddings: true,
    saas: true,
  });
  const admin = createTraceClient({
    url: db.traceMigration.url,
    username: db.traceMigration.username,
    password: db.traceMigration.password,
  });
  const principals: Record<string, [TraceReaders, ReadAuthority]> = {
    owner: [db.traceReaders, owner],
    member: [db.traceReaders, member],
    other: [db.traceReaders, other],
    worker: [db.traceReaders, worker],
    unentitled: [unentitled, owner],
    saas: [saas, owner],
  };
  const tables = [
    ...Object.keys(traceTables),
    "session_identities",
    "audit_events",
    SESSION_READS_TABLE,
    "control_metrics_health",
  ];
  const isCorpus = (table: string): table is TraceTable => table in traceTables;
  // Direct source access stays denied; definer views expose each table's policy alone.
  const observe = async () => {
    const seen: Record<string, Record<string, string[]>> = {};
    for (const [name, [readers, authority]] of Object.entries(principals)) {
      seen[name] = {};
      for (const table of tables) {
        const columns = isCorpus(table)
          ? `organization_id,session_id,toString(${traceTables[table].identity}) AS identity,generation,revision`
          : table === "audit_events" || table === SESSION_READS_TABLE
            ? "audit_id"
            : "organization_id,session_id";
        const result = await readers.read(authority, (client) =>
          client.query(
            `SELECT DISTINCT ${columns} FROM policy_diff_${table} WHERE ${table === "audit_events" ? "has({audits:Array(UUID)},audit_id)" : "has({sessions:Array(UUID)},session_id)"}`,
            {
              sessions: Object.values(sessions),
              audits: Object.values(audits).map((row) => row.id),
            },
          ),
        );
        seen[name][table] = result.rows
          .map((row) => Object.values(row).join("|"))
          .sort();
      }
    }
    return seen;
  };
  /** What spec §7.5 says each principal sees of one corpus table, from the rows inserted above. */
  const expectedCorpus = (principal: string, table: TraceTable) => {
    const isAdmin = principal !== "member";
    const organization =
      principal === "other" ? other.organizationId : owner.organizationId;
    // The foreign organization never opted in; SaaS mode also needs the paid entitlement.
    const entitled =
      organization === owner.organizationId &&
      principal !== "unentitled" &&
      principal !== "saas";
    return inserted
      .filter((item) => {
        if (
          item.table !== table ||
          organizationOf(item.session) !== organization
        )
          return false;
        const rescanned = item.session === sessions.rescanned;
        const isPublic = ![sessions.private, sessions.foreignPrivate].includes(
          item.session,
        );
        if (
          item.session === sessions.purged ||
          (!isAdmin && !isPublic) ||
          item.generation !== (rescanned ? 1n : 0n)
        )
          return false;
        return traceTables[table].vector
          ? entitled && item.session === sessions.vector && item.revision === 1n
          : item.revision <= (rescanned ? 2n : 1n);
      })
      .map((item) =>
        [
          organization,
          item.session,
          item.identity,
          String(item.generation),
          String(item.revision),
        ].join("|"),
      )
      .sort();
  };
  const keys = (organization: string, ids: readonly string[]) =>
    ids.map((id) => `${organization}|${id}`).sort();
  const auditIds = (names: ReadonlyArray<keyof typeof audits>) =>
    names.map((name) => audits[name].id).sort();
  const readIds = (names: ReadonlyArray<keyof typeof reads>) =>
    names.map((name) => reads[name].audit_id).sort();
  const ownSessions = Object.values(sessions).filter(
    (id) => !foreignIds.includes(id),
  );
  const expectedControl = (principal: string) => {
    const admins = ["owner", "worker", "unentitled", "saas"];
    if (principal === "member")
      return {
        session_identities: [],
        control_metrics_health: [],
        audit_events: auditIds(["own", "publicGet"]),
        [SESSION_READS_TABLE]: readIds(["publicToTarget", "search"]),
      };
    if (principal === "other")
      return {
        session_identities: [],
        control_metrics_health: keys(other.organizationId, foreignIds),
        audit_events: auditIds(["foreign"]),
        [SESSION_READS_TABLE]: readIds(["foreign"]),
      };
    expect(admins).toContain(principal);
    return {
      session_identities: keys(owner.organizationId, [sessions.purged]),
      control_metrics_health: keys(owner.organizationId, ownSessions),
      audit_events: auditIds([
        "own",
        "publicGet",
        "privateGet",
        "purgedGet",
        "failedGet",
        "search",
      ]),
      [SESSION_READS_TABLE]: readIds([
        "publicToTarget",
        "privateSource",
        "privateTarget",
        "search",
      ]),
    };
  };
  try {
    for (const table of tables) {
      await admin.command({
        query: `CREATE OR REPLACE VIEW api_ro.policy_diff_${table} DEFINER=ac_trace_view_owner SQL SECURITY DEFINER AS SELECT * FROM ac_trace.${table}`,
      });
      await admin.command({
        query: `GRANT SELECT ON api_ro.policy_diff_${table} TO ac_trace_reader`,
      });
    }
    const current = await observe();
    for (const [principal, seen] of Object.entries(current)) {
      for (const table of Object.keys(traceTables) as TraceTable[])
        expect(seen[table], `${principal} ${table}`).toEqual(
          expectedCorpus(principal, table),
        );
      expect(
        Object.fromEntries(
          Object.entries(seen).filter(([table]) => !isCorpus(table)),
        ),
        principal,
      ).toEqual(expectedControl(principal));
    }
    // The same rows under the per-row dictionary policies these replaced.
    for (const statement of legacyScopePolicies())
      await admin.command({ query: statement });
    expect(await observe()).toEqual(current);
  } finally {
    for (const statement of securityStatements(db.traceMigration))
      await admin.command({ query: statement });
    for (const table of tables)
      await admin.command({
        query: `DROP VIEW IF EXISTS api_ro.policy_diff_${table}`,
      });
    await db.prisma.traceAnalyticsRetention.update({
      where: { id: 1 },
      data: { retainedAfter: retention.retainedAfter },
    });
    expect(
      await cleanup([
        () => unentitled.close(),
        () => saas.close(),
        () => admin.close(),
      ]),
    ).toEqual([]);
  }
});
