import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import { createTraceClient, migrateTraces } from "@agentcommons/traces";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  refreshSearchCorpus,
  startTraceDatabase,
} from "../../../packages/traces/test/support.js";
import { TraceFixtures } from "../../../packages/traces/test/fixtures.js";
import { CursorCodec } from "../src/services/cursor.js";
import { requireCaller, type ServiceContext } from "../src/services/context.js";
import { SearchService } from "../src/services/search.js";
import { countingReaders } from "./query-counter.js";
import { provisionMember, provisionOrganization, releaser } from "./support.js";

// A long session with 320 MiB of payload exercises metadata scans whose input is
// larger than the 256 MiB reader cap even though the metadata result itself is small.
// The existing search-shape fixture covers 40k short messages spread over 400 sessions.
const MESSAGES = 40_000;
const { defer, release } = releaser();
let db: Awaited<ReturnType<typeof startTraceDatabase>>;
let admin: ServiceContext;
let member: ServiceContext;
let search: SearchService;
let counter: ReturnType<typeof countingReaders>;

beforeAll(async () => {
  db = await startTraceDatabase();
  defer(() => db.close());
  const fixtures = new TraceFixtures(db);
  defer(() => fixtures.close());
  const organization = await provisionOrganization(db, "read-memory");
  admin = organization.context;
  member = (await provisionMember(db, organization.owner, "reader@example.com"))
    .context;
  const { id } = await fixtures.sessionFor(admin, {
    visibility: "PUBLIC",
    fields: {
      title: "Long session with large tool results",
      message_count: MESSAGES,
    },
  });
  // Generate native rows in ClickHouse so the fixture does not allocate the complete
  // transcript in the test process. The searchable prefix is independent of payload size.
  await fixtures.client.command({
    query: `INSERT INTO messages
      (organization_id,session_id,message_id,seq,role,kind,content,tool_input,
       search_text,searchable,received_at,revision,generation,deleted,fingerprint)
      SELECT {organization:String},{session:UUID},generateUUIDv4(),number,'USER','TEXT',
        concat('memoryfixture ',repeat('abcdefgh ',910)),'null','memoryfixture',true,
        toDateTime64('2026-08-01 00:00:00',6),1,0,0,repeat('a',64)
      FROM numbers({messages:UInt64})`,
    query_params: {
      organization: requireCaller(admin).organizationId,
      session: id,
      messages: MESSAGES,
    },
  });
  await refreshSearchCorpus(db);
  counter = countingReaders(db.traceReaders);
  search = new SearchService({
    prisma: db.prisma,
    readers: counter.readers,
    audit: db.audit,
    cursors: new CursorCodec("read-memory-fixture-cursor-secret"),
  });
}, 120_000);
afterAll(release);

// @req R-SRCH-06 @req R-GET-07 @req R-GET-10
it("shares candidate and neighbor scans under the reader memory limit for large sessions", async () => {
  const input = { query: "memoryfixture", limit: 1, context: 1 };
  for (const [who, context] of [
    ["admin", admin],
    ["member", member],
  ] as const) {
    counter.drain();
    const started = performance.now();
    const single = await search.execute(context, input);
    const singleMs = performance.now() - started;
    const queries = counter.drain();
    expect(single.result.total).toEqual({ sessions: 1, hits: MESSAGES });
    expect(single.result.blocks).toHaveLength(1);
    expect(single.result.blocks[0]?.messages).toHaveLength(2);
    expect(single.result.partial).toBeNull();
    expect(singleMs, `${who} single search ms`).toBeLessThan(2500);
    // Inspect the native plan, not occurrences in SQL text: an ordinary CTE appears
    // once in the statement but ClickHouse expands it into two physical table scans.
    const neighbors = queries.find((query) =>
      query.sql.includes("WITH ordered"),
    );
    expect(neighbors).toBeDefined();
    if (!neighbors)
      throw new Error("Search did not fetch neighboring messages.");
    const plan = await db.traceReaders.read(requireCaller(context), (client) =>
      client.query(`EXPLAIN PIPELINE ${neighbors.sql}`, neighbors.parameters),
    );
    expect(
      plan.rows.filter((row) =>
        String(row.explain).includes("ReadFromMergeTree"),
      ),
    ).toHaveLength(1);
    const headers = await db.traceReaders.read(
      requireCaller(context),
      (client) =>
        client.query(
          `EXPLAIN PLAN header=1 ${neighbors.sql}`,
          neighbors.parameters,
        ),
    );
    // Even the physical source header is narrow: metadata must not decompress content
    // or tool_input anywhere in its pipeline merely to compute their byte lengths.
    const columns = headers.rows.map((row) => String(row.explain)).join("\n");
    expect(columns).toContain("payload_bytes");
    expect(columns).not.toMatch(/\b(?:content|tool_input)\b/);
    const concurrentStarted = performance.now();
    const concurrent = await Promise.all(
      Array.from({ length: 4 }, () => search.execute(context, input)),
    );
    for (const page of concurrent) expect(page.result).toEqual(single.result);
    expect(
      performance.now() - concurrentStarted,
      `${who} four concurrent searches wall ms`,
    ).toBeLessThan(4000);
  }
});

// @req R-GET-10 @req R-SEC-01
it("keeps payload byte sizes aligned with the latest published message, including multibyte text and pending revisions", async () => {
  const fixtures = new TraceFixtures(db);
  try {
    const { id } = await fixtures.sessionFor(admin, { visibility: "PUBLIC" });
    const messageId = randomUUID();
    const fields = {
      message_id: messageId,
      seq: 0,
      role: "USER",
      kind: "TEXT",
      content: "é🍵",
      tool_input: '{"value":"✓"}',
      searchable: false,
    };
    await fixtures.insert("messages", id, fields);
    const pending = {
      ...fields,
      content: "longer pending text",
      tool_input: "null",
    };
    const scope = {
      organizationId: requireCaller(admin).organizationId,
      sessionId: id,
      revision: 3n,
      generation: 0n,
    };
    await fixtures.insertRaw("messages", scope, pending);
    const bytes = (row: typeof fields) =>
      Buffer.byteLength(row.content) + Buffer.byteLength(row.tool_input);
    const read = (context: ServiceContext) =>
      db.traceReaders.read(requireCaller(context), async (client) => {
        const result = await client.query(
          "SELECT payload_bytes FROM api_ro.message_metadata WHERE session_id={id:UUID} AND message_id={message:UUID}",
          { id, message: messageId },
        );
        return Number(result.rows[0]?.payload_bytes);
      });
    for (const context of [admin, member])
      expect(await read(context)).toBe(bytes(fields));
    await db.prisma.traceSessionControl.update({
      where: {
        organizationId_id: { organizationId: scope.organizationId, id },
      },
      data: {
        acceptedRevision: scope.revision,
        publishedRevision: scope.revision,
      },
    });
    for (const context of [admin, member])
      expect(await read(context)).toBe(bytes(pending));
  } finally {
    await fixtures.close();
  }
});

// @req R-GET-10
it("repairs an interrupted payload-size upgrade before publishing the metadata view and skips completed backfills", async () => {
  const native = createTraceClient({
    url: db.traceMigration.url,
    username: db.traceMigration.username,
    password: db.traceMigration.password,
  });
  const count = async (query: string) => {
    const result = await native.query({ query, format: "JSONEachRow" });
    const rows = await result.json<{ n: string | number }>();
    return Number(rows[0]?.n ?? 0);
  };
  try {
    // An older deployment had these payload rows but no scalar. The interrupted
    // attempt added its definition and stopped before materializing historical parts.
    await native.command({
      query:
        "ALTER TABLE ac_trace.backfills DELETE WHERE name='message_payload_bytes_v1' SETTINGS mutations_sync=1",
    });
    await native.command({
      query: "ALTER TABLE ac_trace.messages DROP COLUMN payload_bytes",
    });
    await native.command({
      query:
        "ALTER TABLE ac_trace.messages ADD COLUMN payload_bytes UInt64 MATERIALIZED length(content)+length(tool_input)",
    });
    await migrateTraces(db.traceMigration);
    expect(
      await count(
        "SELECT count() AS n FROM ac_trace.backfills WHERE name='message_payload_bytes_v1'",
      ),
    ).toBe(1);
    expect(
      await count(
        "SELECT count() AS n FROM system.parts WHERE database='ac_trace' AND table='messages' AND active AND name NOT IN (SELECT name FROM system.parts_columns WHERE database='ac_trace' AND table='messages' AND active AND column='payload_bytes')",
      ),
    ).toBe(0);
    expect(
      await count(
        "SELECT count() AS n FROM ac_trace.messages WHERE payload_bytes!=length(content)+length(tool_input)",
      ),
    ).toBe(0);
    const mutations =
      "SELECT count() AS n FROM system.mutations WHERE database='ac_trace' AND table='messages' AND command LIKE '%MATERIALIZE COLUMN payload_bytes%'";
    const completed = await count(mutations);
    expect(completed).toBeGreaterThan(0);
    expect(await count(`${mutations} AND NOT is_done`)).toBe(0);
    await migrateTraces(db.traceMigration);
    expect(await count(mutations)).toBe(completed);
  } finally {
    await native.close();
  }
});
