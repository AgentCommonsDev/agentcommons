import { cleanup as cleanupAll } from "../../../scripts/cleanup.js";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { startTraceDatabase } from "../../../packages/traces/test/support.js";
import { TraceFixtures } from "../../../packages/traces/test/fixtures.js";
import { TraceReaders } from "@agentcommons/traces";
import { formatGet, formatSearch } from "@agentcommons/core/format";
import { z } from "zod";
import { parse as parseYaml } from "yaml";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedPolicies } from "../src/services/policies.js";
import { CursorCodec } from "../src/services/cursor.js";
import { QueryService } from "../src/services/query.js";
import { SearchService } from "../src/services/search.js";
import { SessionService } from "../src/services/session.js";
import { requireCaller, type ServiceContext } from "../src/services/context.js";

const cleanup: (() => Promise<unknown>)[] = [];
let writer: Client;
let db: Awaited<ReturnType<typeof startTraceDatabase>>;
let fixtures: TraceFixtures;
let search: SearchService;
let sessions: SessionService;
let query: QueryService;
const installationId = randomUUID();
const ids = {
  public: randomUUID(),
  private: randomUUID(),
  child: randomUUID(),
  leaf: randomUUID(),
  other: randomUUID(),
  weights: randomUUID(),
  long: randomUUID(),
  second: randomUUID(),
  empty: randomUUID(),
};
const corpusIds = new Map<string, string>();
function context(
  organizationId = "org-a",
  admin = false,
  permissions = true,
): ServiceContext {
  return {
    caller: {
      organizationId,
      userId: "owner",
      apiKeyId: null,
      role: "admin",
      authMethod: "key",
      permissions: {
        sessions: permissions ? ["read"] : [],
        ...(admin ? { admin: ["*"] } : {}),
      },
    },
    requestId: randomUUID(),
    transport: "rest",
    ip: "127.0.0.1",
    userAgent: "read-test",
    startedAt: Date.now(),
    headers: new Headers(),
  };
}
async function session(
  id: string,
  options: {
    organization?: string;
    visibility?: string;
    parent?: string;
    repo?: string;
    title?: string;
  } = {},
) {
  const org = options.organization ?? "org-a";
  await fixtures.session({
    id,
    organizationId: org,
    userId: "owner",
    keyId: org === "org-a" ? "key-a" : "key-b",
    installationId,
    ...(options.parent ? { parent: options.parent } : {}),
    visibility: options.visibility === "PRIVATE" ? "PRIVATE" : "PUBLIC",
    fields: {
      title: options.title ?? "Read service fixture",
      repo_name: options.repo ?? "host/team/repo",
      branch: "main",
      model: "test-model",
      models_used: ["test-model"],
      tools_used: ["Read", "Bash"],
      input_tokens: "9007199254740993",
      output_tokens: "42",
    },
  });
  const batchId = randomUUID();
  return batchId;
}
async function message(
  sessionId: string,
  batchId: string,
  seq: number,
  content: string,
  options: {
    org?: string;
    role?: string;
    kind?: string;
    tool?: string;
    input?: unknown;
    searchText?: string;
    timestamp?: string;
  } = {},
) {
  const raw = randomUUID();
  const kind = options.kind ?? "TEXT";
  await fixtures.insert("raw_records", sessionId, {
    raw_record_id: raw,
    ingest_batch_id: batchId,
    pos: String(seq),
    record_type: "message",
    payload: JSON.stringify({ content }),
    redaction_context: "null",
    received_at: new Date("2026-08-15T00:00:00Z"),
  });
  await fixtures.insert("messages", sessionId, {
    message_id: randomUUID(),
    raw_record_id: raw,
    ingest_batch_id: batchId,
    seq,
    block_index: 0,
    role: options.role ?? "USER",
    kind,
    content,
    tool_name: options.tool ?? null,
    tool_input: JSON.stringify(options.input ?? null),
    searchable: !["THINKING", "META"].includes(kind),
    search_text: options.searchText ?? content,
    timestamp: options.timestamp ?? "2026-08-15T00:00:00Z",
    received_at: new Date("2026-08-15T00:00:00Z"),
    input_tokens: "9007199254740993",
    output_tokens: "42",
  });
  const result = await fixtures.client.query({
    query:
      "SELECT count(DISTINCT message_id) AS count FROM messages WHERE session_id={id:UUID}",
    query_params: { id: sessionId },
    format: "JSONEachRow",
  });
  const counted = z
    .array(z.object({ count: z.coerce.number() }))
    .parse(await result.json());
  await fixtures.update("sessions", sessionId, {
    message_count: counted[0]?.count ?? 0,
  });
}
const corpusSchema = z.array(
  z.object({
    id: z.string(),
    title: z.string(),
    messages: z.array(
      z.object({
        role: z.enum(["USER", "ASSISTANT", "SYSTEM"]),
        kind: z.enum(["TEXT", "TOOL_RESULT"]),
        content: z.string(),
      }),
    ),
  }),
);
beforeAll(async () => {
  db = await startTraceDatabase();
  cleanup.push(() => db.close());
  fixtures = new TraceFixtures(db);
  cleanup.push(() => fixtures.close());
  writer = new Client({ connectionString: db.urls.migration });
  await writer.connect();
  cleanup.push(() => writer.end());
  const dependencies = {
    prisma: db.prisma,
    readers: db.traceReaders,
    audit: db.audit,
    cursors: new CursorCodec("integration-cursor-secret-with-enough-entropy"),
  };
  search = new SearchService(dependencies);
  sessions = new SessionService(dependencies);
  query = new QueryService(dependencies);
  await writer.query(
    `INSERT INTO "user"(id,name,email,"updatedAt") VALUES('owner','Owner','owner@example.test',now()); INSERT INTO organization(id,name,slug,"createdAt") VALUES('org-a','A','a',now()),('org-b','B','b',now()); INSERT INTO member(id,"organizationId","userId",role,"createdAt") VALUES('member-a','org-a','owner','admin',now()),('member-b','org-b','owner','admin',now()); INSERT INTO api_key_owner(key_id,organization_id,user_id) VALUES('key-a','org-a','owner'),('key-b','org-b','owner')`,
  );
  for (const org of ["org-a", "org-b"])
    await seedPolicies(db.prisma, org, "owner");
  for (const [id, organizationId] of [
    ["key-a", "org-a"],
    ["key-b", "org-b"],
  ] as const)
    await db.prisma.apikey.create({
      data: {
        id,
        referenceId: organizationId,
        key: `fixture-hash-${id}`,
        createdAt: new Date(),
        updatedAt: new Date(),
        permissions: JSON.stringify({ sessions: ["read"], admin: ["*"] }),
      },
    });
  for (const org of ["org-a", "org-b"])
    await writer.query(
      "INSERT INTO installation(organization_id,id,hostname,os_user,platform,arch) VALUES($1,$2,'test-host','test-user','linux','x64')",
      [org, installationId],
    );
  const publicBatch = await session(ids.public, { title: "Visible root" });
  for (let seq = 0; seq < 7; seq++)
    await message(
      ids.public,
      publicBatch,
      seq,
      seq % 2
        ? "Internal reasoning should not appear in search"
        : `Circuit breaker retry budget request ${String(seq)}`,
      { kind: seq % 2 ? "THINKING" : "TEXT" },
    );
  await fixtures.insert("session_files", ids.public, {
    file_id: "src/auth/limiter.ts",
    path: "src/auth/limiter.ts",
    ops: ["write"],
  });
  const privateBatch = await session(ids.private, {
    visibility: "PRIVATE",
    parent: ids.public,
    title: "Hidden middle",
  });
  await message(
    ids.private,
    privateBatch,
    0,
    "Circuit breaker classified private needle",
  );
  const childBatch = await session(ids.child, {
    parent: ids.private,
    title: "Visible grandchild",
  });
  await message(ids.child, childBatch, 0, "Circuit breaker public child");
  const leafBatch = await session(ids.leaf, { parent: ids.child });
  await message(ids.leaf, leafBatch, 0, "Leaf tool call", {
    kind: "TOOL_USE",
    role: "ASSISTANT",
    tool: "Bash",
    input: { command: "printf hello" },
  });
  const otherBatch = await session(ids.other, {
    organization: "org-b",
    repo: "host/other/repo",
  });
  await message(
    ids.other,
    otherBatch,
    0,
    "Circuit breaker other organization secret",
    { org: "org-b" },
  );
  const weights = await session(ids.weights);
  for (const [seq, role, kind] of [
    [3, "USER", "TEXT"],
    [2, "ASSISTANT", "TEXT"],
    [1, "ASSISTANT", "TOOL_USE"],
    [0, "SYSTEM", "TOOL_RESULT"],
  ] as const)
    await message(ids.weights, weights, seq, "rankingmarker", { role, kind });
  const long = await session(ids.long);
  await message(ids.long, long, 0, "🙂".repeat(262144), { kind: "THINKING" });
  await message(ids.long, long, 1, "tool input", {
    role: "ASSISTANT",
    kind: "TOOL_USE",
    input: { command: "x".repeat(12000) },
    tool: "Bash",
  });
  const second = await session(ids.second, { repo: "host/second/repo" });
  await message(ids.second, second, 0, "Circuit breaker at exclusive date", {
    timestamp: "2026-09-01T00:00:00Z",
  });
  await session(ids.empty, { repo: "host/team/empty" });
  const corpus = corpusSchema.parse(
    JSON.parse(
      await readFile(
        new URL("../../../fixtures/search-corpus.json", import.meta.url),
        "utf8",
      ),
    ),
  );
  for (const fixture of corpus) {
    const id = randomUUID();
    corpusIds.set(fixture.id, id);
    const batch = await session(id, {
      title: fixture.title,
      repo: "host/team/golden",
    });
    for (const [seq, item] of fixture.messages.entries())
      await message(id, batch, seq, item.content, {
        role: item.role,
        kind: item.kind,
        searchText:
          item.kind === "TOOL_RESULT"
            ? item.content.slice(0, 2048) + "\n" + item.content.slice(-2048)
            : item.content,
      });
  }
});
afterAll(async () => {
  expect(await cleanupAll(cleanup.splice(0).reverse())).toEqual([]);
});

describe("read services on ClickHouse", () => {
  // @req R-ING-04 @req R-SRCH-06
  it("never resurrects search matches from an edited or deleted native message", async () => {
    const id = randomUUID();
    const batch = await session(id);
    await message(id, batch, 0, "obsoleteprojectionneedle");
    const find = (query: string) =>
      search.execute(context(), { query, context: 0 });
    expect(
      (await find("obsoleteprojectionneedle")).result.blocks.map(
        (block) => block.session_id,
      ),
    ).toContain(id);
    await fixtures.update("messages", id, {
      content: "currentprojectionneedle",
      search_text: "currentprojectionneedle",
    });
    expect((await find("obsoleteprojectionneedle")).result.blocks).toEqual([]);
    expect(
      (await find("currentprojectionneedle")).result.blocks.map(
        (block) => block.session_id,
      ),
    ).toContain(id);
    await fixtures.update("messages", id, { deleted: 1 });
    expect((await find("currentprojectionneedle")).result.blocks).toEqual([]);
  });
  // @req R-SQL-04 @req R-AUD-01
  it("reports an unavailable native database as an audited service failure", async () => {
    const unavailable = new TraceReaders(
      { ...db.traceConfig, url: "http://127.0.0.1:1" },
      db.prisma,
    );
    try {
      const service = new QueryService({
        prisma: db.prisma,
        readers: unavailable,
        audit: db.audit,
        cursors: new CursorCodec("unavailable-query-cursor-secret"),
      });
      await expect(
        service.execute(context(), { sql: "SELECT 1" }),
      ).rejects.toMatchObject({
        statusCode: 503,
        code: "TRACE_QUERY_UNAVAILABLE",
        audited: true,
      });
    } finally {
      await unavailable.close();
    }
  });
  // @req R-SRCH-03 @req R-SRCH-04 @req R-SRCH-05
  it("enforces all filter boundaries and message time with OR within keys", async () => {
    const result = await search.execute(context(), {
      query: "circuit breaker",
      filters: {
        session_id: [ids.public, ids.second],
        branch: ["wrong", "main"],
        role: ["USER"],
        since: ["2026-08-20T00:00:00Z", "2026-08-15T00:00:00Z"],
        until: ["2026-08-31T00:00:00Z", "2026-09-01T00:00:00Z"],
        file_prefix: ["wrong/", "src/auth/"],
      },
      context: 0,
    });
    expect(result.result.blocks.map((block) => block.session_id)).toEqual([
      ids.public,
    ]);
    expect(
      result.result.blocks
        .flatMap((block) => block.messages)
        .every((row) => row.role === "USER"),
    ).toBe(true);
    await expect(
      search.execute(context(), { query: "x", filters: { owner: "x" } }),
    ).rejects.toThrow("Valid filters");
    await expect(
      search.execute(context(), { query: "x", filters: { role: [] } }),
    ).rejects.toThrow("Valid filters");
    await expect(
      search.execute(context(), { query: "x", filters: { repo_name: "repo" } }),
    ).rejects.toMatchObject({ code: "AMBIGUOUS_REPO" });
    const short = await search.execute(context(), {
      query: "",
      filters: { repo_name: "empty" },
    });
    expect(short.result.blocks).toEqual([]);
  });
  // @req R-SRCH-06 @req R-SRCH-07 @req R-SRCH-08 @req R-SRCH-11
  it("ranks weighted messages, caps before merging, excludes thinking and binds stable cursors", async () => {
    const weighted = await search.execute(context(), {
      query: "rankingmarker",
      context: 0,
      limit: 50,
    });
    expect(
      weighted.result.blocks
        .flatMap((block) => block.messages)
        .map((row) => row.seq),
    ).toEqual([1, 2, 3]);
    const best = await search.execute(context(), {
      query: "rankingmarker",
      context: 0,
      limit: 1,
    });
    expect(best.result.blocks[0]?.messages[0]?.seq).toBe(3);
    const ordered = await query.execute(context(), {
      sql: "SELECT seq,rank FROM search_messages(q='rankingmarker') ORDER BY rank DESC",
    });
    expect(ordered.result.rows.map((row) => row[0])).toEqual([3, 2, 1, 0]);
    const merged = await search.execute(context(), {
      query: "circuit breaker",
      filters: { session_id: ids.public },
      context: 1,
      limit: 50,
    });
    expect(merged.result.blocks).toHaveLength(1);
    expect(
      merged.result.blocks[0]?.messages.map((row) => [row.seq, row.hit]),
    ).toEqual([
      [0, true],
      [2, true],
      [4, true],
      [6, false],
    ]);
    const input = { query: "circuit breaker", context: 0, limit: 2 };
    const first = await search.execute(context(), input);
    const again = await search.execute(context(), input);
    expect(first.result).toEqual(again.result);
    expect(first.result.cursor).not.toBeNull();
    const next = await search.execute(context(), {
      ...input,
      cursor: first.result.cursor,
    });
    const keys = (output: typeof first.result) =>
      output.blocks.flatMap((block) =>
        block.messages
          .filter((row) => row.hit)
          .map((row) => `${block.session_id}:${String(row.seq)}`),
      );
    expect(
      keys(next.result).some((key) => keys(first.result).includes(key)),
    ).toBe(false);
    await expect(
      search.execute(context("org-b"), {
        ...input,
        cursor: first.result.cursor,
      }),
    ).rejects.toMatchObject({ code: "INVALID_CURSOR" });
    await expect(
      search.execute(context(), {
        ...input,
        query: "changed",
        cursor: first.result.cursor,
      }),
    ).rejects.toMatchObject({ code: "INVALID_CURSOR" });
  });
  // @req R-SRCH-10
  it("returns one most recent anchor for empty queries", async () => {
    const result = await search.execute(context(), {
      query: "",
      filters: { session_id: [ids.public, ids.second] },
      context: 0,
    });
    expect(
      result.result.blocks.flatMap((block) =>
        block.messages.map((row) => [block.session_id, row.seq]),
      ),
    ).toEqual([
      [ids.second, 0],
      [ids.public, 6],
    ]);
  });
  // @req R-SRCH-05 @req R-SRCH-10 @req R-SRCH-11
  it("preserves native microseconds in time filters and pagination", async () => {
    const expected = [];
    for (const fraction of ["000100", "000200", "000300"]) {
      const id = randomUUID();
      expected.unshift(id);
      const batch = await session(id, { repo: "host/team/microseconds" });
      await message(id, batch, 0, "microsecond ordering", {
        timestamp: `2026-08-15T00:00:00.${fraction}Z`,
      });
    }
    const found = [];
    let cursor: string | null = null;
    do {
      const page = await search.execute(context(), {
        query: "",
        filters: {
          repo_name: "host/team/microseconds",
          since: ["2026-08-15T00:00:00.000400Z", "2026-08-15T00:00:00Z"],
        },
        context: 0,
        limit: 1,
        cursor,
      });
      found.push(...page.result.blocks.map((block) => block.session_id));
      cursor = page.result.cursor;
      expect(found.length).toBeLessThanOrEqual(3);
    } while (cursor);
    expect(found).toEqual(expected);
  });
  // @req R-SRCH-09 @req R-SRCH-11
  it("truncates search pages at 32 KB and resumes without dropping ranked hits", async () => {
    const expected = [];
    for (let index = 0; index < 12; index++) {
      const id = randomUUID();
      expected.push(id);
      const batch = await session(id, { repo: "host/team/budget" });
      for (let seq = 0; seq < 7; seq++)
        await message(
          id,
          batch,
          seq,
          `${seq === 3 ? "budgetmarker " : ""}${"🙂".repeat(350)}`,
        );
    }
    const found = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = await search.execute(context(), {
        query: "budgetmarker",
        filters: { repo_name: "host/team/budget" },
        context: 3,
        limit: 50,
        cursor,
      });
      expect(
        Buffer.byteLength(JSON.stringify(page.result)),
      ).toBeLessThanOrEqual(32768);
      expect(
        Buffer.byteLength(formatSearch(page.result).text),
      ).toBeLessThanOrEqual(32768);
      if (pages === 0) expect(page.result.truncated_response).toBe(true);
      found.push(
        ...page.result.blocks.flatMap((block) =>
          block.messages
            .filter((message) => message.hit)
            .map(() => block.session_id),
        ),
      );
      cursor = page.result.cursor;
      pages++;
      expect(pages).toBeLessThanOrEqual(12);
    } while (cursor);
    expect(found.sort()).toEqual(expected.sort());
    expect(pages).toBeGreaterThan(1);
  });
  // @req R-GET-02 @req R-SRCH-09
  it("keeps search and transcript pagination usable with oversized native metadata", async () => {
    const id = randomUUID();
    const batch = await session(id, { title: "Large metadata boundary" });
    await message(id, batch, 0, "oversizedmetadataprobe readable transcript");
    const metadata = '\\"🙂'.repeat(12_000);
    await fixtures.update("sessions", id, { model: metadata });
    await fixtures.update("messages", id, {
      model: metadata,
      tool_name: metadata,
      tool_use_id: metadata,
      agent_id: metadata,
    });
    const detail = await sessions.get(context(), { session_id: id });
    expect(detail.result.messages[0]?.content).toContain("readable transcript");
    expect(detail.result.messages[0]?.truncated_fields).toEqual([
      "agent_id",
      "model",
      "tool_name",
      "tool_use_id",
    ]);
    expect(detail.result.messages[0]?.model).toMatch(/…$/u);
    expect(detail.result.messages[0]?.model).not.toContain("�");
    expect(
      Buffer.byteLength(JSON.stringify(detail.result)),
    ).toBeLessThanOrEqual(32768);
    expect(
      Buffer.byteLength(formatGet(detail.result).text),
    ).toBeLessThanOrEqual(32768);
    expect(formatGet(detail.result).text).toContain(
      'truncated_fields: ["agent_id","model","tool_name","tool_use_id"]',
    );
    const found = await search.execute(context(), {
      query: "oversizedmetadataprobe",
    });
    expect(found.result.blocks[0]?.session_id).toBe(id);
    expect(found.result.blocks[0]?.truncated_fields).toEqual(["model"]);
    expect(found.result.blocks[0]?.messages[0]?.truncated_fields).toEqual([
      "tool_name",
      "tool_use_id",
    ]);
    expect(Buffer.byteLength(JSON.stringify(found.result))).toBeLessThanOrEqual(
      32768,
    );
    expect(
      Buffer.byteLength(formatSearch(found.result).text),
    ).toBeLessThanOrEqual(32768);
    expect(formatSearch(found.result).text).toContain(
      'truncated_fields: ["model"]',
    );
    const stored = await db.traceReaders.read(
      requireCaller(context()),
      (client) =>
        client.query("SELECT model FROM messages WHERE session_id={id:UUID}", {
          id,
        }),
    );
    expect(stored.rows[0]?.model).toBe(metadata);
  });
  // @req R-GET-01 @req R-GET-02 @req R-GET-03
  it("returns visible links, every message kind, inclusive ranges and byte continuations for a 1 MB message", async () => {
    const root = await sessions.get(context(), {
      session_id: ids.public,
      from: 1,
      to: 2,
    });
    expect(root.result.header.children).toEqual([]);
    expect(root.result.header.input_tokens).toBe("9007199254740993");
    expect(root.result.messages.map((row) => row.kind)).toEqual([
      "THINKING",
      "TEXT",
    ]);
    const child = await sessions.get(context(), { session_id: ids.child });
    expect(child.result.header.parent).toBeNull();
    expect(child.result.header.root_session_id).toBe(ids.child);
    const first = await sessions.get(context(), { session_id: ids.long });
    expect(Buffer.byteLength(first.result.messages[0]?.content ?? "")).toBe(
      4096,
    );
    expect(first.result.next).toEqual({ seq: 0, offset: 4096 });
    const next = await sessions.get(context(), {
      session_id: ids.long,
      cursor: first.result.next,
    });
    expect(next.result.next).toEqual({ seq: 0, offset: 8192 });
    expect(next.result.messages[0]?.content).not.toContain("�");
    const end = await sessions.get(context(), {
      session_id: ids.long,
      from: 0,
      to: 0,
      cursor: { seq: 0, offset: 1048576 - 4 },
    });
    expect(end.result.messages[0]?.content).toBe("🙂");
    expect(end.result.next).toBeNull();
    expect(Buffer.byteLength(JSON.stringify(first.result))).toBeLessThanOrEqual(
      32768,
    );
    expect(Buffer.byteLength(formatGet(first.result).text)).toBeLessThanOrEqual(
      32768,
    );
    const tool = await sessions.get(context(), {
      session_id: ids.long,
      from: 1,
    });
    expect(tool.result.messages[0]?.content).toContain('"command"');
    expect(tool.result.next?.offset).toBeGreaterThan(0);
    expect(tool.result.messages[0]).not.toHaveProperty("tool_input");
    await expect(
      sessions.get(context(), {
        session_id: ids.long,
        cursor: { seq: 0, offset: 1 },
      }),
    ).rejects.toMatchObject({ code: "INVALID_CURSOR" });
    await expect(
      sessions.get(context(), { session_id: ids.long, from: 2, to: 1 }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
  // @req R-SQL-01 @req R-SQL-02 @req R-SQL-03 @req R-SQL-04
  it("executes guarded composable SQL with precise types, row/cell/body limits and SQL error positions", async () => {
    const result = await query.execute(context(), {
      sql: "SELECT toInt64('9007199254740993') AS large,toDecimal128('1.234567890123456789',18) AS precise, CAST(NULL AS Nullable(String)) AS absent",
    });
    expect(result.result.rows).toEqual([
      ["9007199254740993", "1.234567890123456789", null],
    ]);
    expect(result.result.columns.map((column) => column.type)).toEqual([
      "Int64",
      "Decimal(38, 18)",
      "Nullable(String)",
    ]);
    const capped = await query.execute(context(), {
      sql: "SELECT arrayJoin(range(1,601)) AS number",
    });
    expect(capped.result.row_count).toBe(500);
    expect(capped.result.capped).toBe(true);
    const cells = await query.execute(context(), {
      sql: `SELECT content FROM messages WHERE session_id='${ids.long}' ORDER BY seq`,
    });
    expect(Buffer.byteLength(z.string().parse(cells.result.rows[0]?.[0]))).toBe(
      2048,
    );
    expect(cells.result.truncated_cells).toEqual([[0, 0]]);
    const body = await query.execute(context(), {
      sql: "SELECT repeat('🙂',1024) AS content,arrayJoin(range(1,501)) AS copy",
    });
    expect(Buffer.byteLength(JSON.stringify(body.result))).toBeLessThanOrEqual(
      256 * 1024,
    );
    expect(body.result.capped).toBe(true);
    expect(body.result.row_count).toBeLessThan(500);
    const memoryFailure: unknown = await query
      .execute(context(), {
        sql: `SELECT m.content FROM messages m CROSS JOIN (SELECT arrayJoin(range(1,501)) AS number) copies WHERE m.session_id='${ids.long}' AND m.seq=0`,
      })
      .catch((error: unknown) => error);
    expect(memoryFailure).toMatchObject({
      statusCode: 400,
      code: "241",
      audited: true,
    });
    expect(memoryFailure).toHaveProperty(
      "message",
      expect.stringContaining("memory limit"),
    );
    const recursive = await query.execute(context(), {
      sql: "WITH RECURSIVE tree AS (SELECT session_id,parent_session_id FROM sessions WHERE parent_session_id IS NULL UNION ALL SELECT s.session_id,s.parent_session_id FROM sessions s JOIN tree t ON s.parent_session_id=t.session_id) SELECT count(*) FROM tree",
    });
    expect(Number(recursive.result.rows[0]?.[0])).toBeGreaterThan(3);
    await expect(
      query.execute(context(), {
        sql: "WITH x AS(DELETE FROM sessions RETURNING *) SELECT * FROM x",
      }),
    ).rejects.toMatchObject({ code: "SQL_REJECTED", audited: true });
    await expect(
      query.execute(context(), {
        sql: "SELECT set_config('agentcommons.organization_id','org-b',true)",
      }),
    ).rejects.toMatchObject({ code: "SQL_REJECTED" });
    const sqlError: unknown = await query
      .execute(context(), { sql: "SELECT missing_column FROM sessions" })
      .catch((error: unknown) => error);
    const failure = z
      .object({
        code: z.string(),
        detail: z.object({ position: z.number().nullable() }),
        message: z.string(),
      })
      .parse(sqlError);
    expect(failure.code).toBe("47");
    expect(failure.detail.position).toBeNull();
    expect(failure.message).toContain("schema_columns");
    const prefixedSql = "/* lead */ SELECT '🙂',missing_column FROM sessions";
    const prefixed: unknown = await query
      .execute(context(), { sql: prefixedSql })
      .catch((error: unknown) => error);
    expect(
      z
        .object({ detail: z.object({ position: z.number().nullable() }) })
        .parse(prefixed).detail.position,
    ).toBeNull();
  });
  // @req R-SQL-04
  it("reports native conflicting SQL aliases as an audited query error without exposing the expressions", async () => {
    const failed: unknown = await query
      .execute(context(), {
        sql: "SELECT 'private-query-value' AS duplicate,NULL AS duplicate",
      })
      .catch((error: unknown) => error);
    expect(failed).toMatchObject({
      statusCode: 400,
      code: "179",
      audited: true,
    });
    const error = z.object({ message: z.string() }).parse(failed);
    expect(error.message).toContain("unique alias");
    expect(error.message).not.toContain("private-query-value");
    const valid = await query.execute(context(), {
      sql: "SELECT 1 AS duplicate,1 AS duplicate,NULL AS empty",
    });
    expect(valid.result.columns.map((column) => column.name)).toEqual([
      "duplicate",
      "duplicate",
      "empty",
    ]);
    expect(valid.result.rows).toEqual([[1, 1, null]]);
  });
  // @req R-GET-01 @req R-GET-02 @req R-LNK-06
  it("bounds pathological header fields and pages all visible child references", async () => {
    const parent = randomUUID();
    const batch = await session(parent, { title: "🙂".repeat(262144) });
    await message(
      parent,
      batch,
      0,
      "Header budget must preserve message progress.",
    );
    const longList = Array.from(
      { length: 100 },
      (_, index) => `${String(index)}${"🙂".repeat(1000)}`,
    );
    await fixtures.update("sessions", parent, {
      tools_used: longList,
      models_used: longList,
    });
    const children = [];
    for (let index = 0; index < 12; index++) {
      const id = randomUUID();
      children.push(id);
      await session(id, { parent, title: "🙂".repeat(1000) });
    }
    await session(randomUUID(), { parent, visibility: "PRIVATE" });
    const page = await sessions.get(context(), { session_id: parent });
    expect(page.result.header.child_count).toBe(12);
    expect(page.result.header.children).toHaveLength(10);
    expect(page.result.header.children_truncated).toBe(true);
    expect(page.result.header.truncated_fields).toEqual(
      expect.arrayContaining([
        "title",
        "tools_used",
        "models_used",
        "children",
      ]),
    );
    expect(
      Buffer.byteLength(JSON.stringify(page.result.header)),
    ).toBeLessThanOrEqual(12 * 1024);
    expect(page.result.messages[0]?.content).toContain(
      "preserve message progress",
    );
    const found = [];
    let cursor: string | null = null;
    do {
      const tree = await sessions.tree(context(), parent, { limit: 3, cursor });
      expect(tree.result.nodes.length).toBeLessThanOrEqual(3);
      expect(
        Buffer.byteLength(JSON.stringify(tree.result)),
      ).toBeLessThanOrEqual(256 * 1024);
      found.push(...tree.result.nodes.map((node) => node.session_id));
      cursor = tree.result.cursor;
      expect(found.length).toBeLessThanOrEqual(13);
    } while (cursor);
    expect(found.sort()).toEqual([parent, ...children].sort());
  });
  it("reassembles a 1 MB redacted raw payload and invalidates its continuation after rescan", async () => {
    let cursor: string | null = null;
    let serialized = "";
    let firstCursor: string | null = null;
    let fragments = 0;
    do {
      const page = await sessions.raw(context(), ids.long, {
        limit: 1,
        cursor,
      });
      const record = page.result.items[0];
      if (!record || record.pos !== "0") break;
      expect(record.payload_fragment).not.toBeNull();
      expect(record.payload_fragment?.offset).toBe(
        Buffer.byteLength(serialized),
      );
      serialized += z.string().parse(record.payload);
      fragments++;
      expect(
        Buffer.byteLength(JSON.stringify(page.result)),
      ).toBeLessThanOrEqual(256 * 1024);
      cursor = page.result.cursor;
      firstCursor ??= cursor;
      expect(fragments).toBeLessThanOrEqual(20);
    } while (cursor);
    expect(JSON.parse(serialized)).toEqual({ content: "🙂".repeat(262144) });
    expect(fragments).toBeGreaterThan(1);
    await fixtures.update(
      "raw_records",
      ids.long,
      { payload: JSON.stringify({ content: "redacted changed payload" }) },
      (row) => row.pos === "0",
    );
    await expect(
      sessions.raw(context(), ids.long, { limit: 1, cursor: firstCursor }),
    ).rejects.toMatchObject({ code: "INVALID_CURSOR", audited: true });
  });
  // @req R-LNK-06 @req R-ORG-07
  it("isolates every read surface and returns hidden-node gaps without hidden facts", async () => {
    const sql = await query.execute(context(), {
      sql: "SELECT session_id FROM sessions",
    });
    expect(sql.result.rows.flat()).not.toContain(ids.private);
    expect(sql.result.rows.flat()).not.toContain(ids.other);
    const admin = await query.execute(context("org-a", true), {
      sql: "SELECT session_id FROM sessions",
    });
    expect(admin.result.rows.flat()).toContain(ids.private);
    expect(admin.result.rows.flat()).not.toContain(ids.other);
    for (const id of [ids.private, ids.other]) {
      await expect(
        sessions.get(context(), { session_id: id }),
      ).rejects.toMatchObject({ statusCode: 404 });
      await expect(sessions.raw(context(), id, {})).rejects.toMatchObject({
        statusCode: 404,
      });
      await expect(sessions.tree(context(), id)).rejects.toMatchObject({
        statusCode: 404,
      });
    }
    const tree = await sessions.tree(context(), ids.leaf);
    expect(tree.result.nodes.map((node) => node.session_id)).toEqual(
      expect.arrayContaining([ids.public, ids.child, ids.leaf]),
    );
    expect(tree.result.nodes).toHaveLength(3);
    expect(
      tree.result.nodes.find((node) => node.session_id === ids.child),
    ).toMatchObject({ parent_session_id: ids.public, gap: true });
    expect(JSON.stringify(tree.result)).not.toContain("Hidden middle");
    const adminTree = await sessions.tree(context("org-a", true), ids.leaf);
    expect(adminTree.result.nodes).toHaveLength(4);
    expect(adminTree.result.nodes.every((node) => !node.gap)).toBe(true);
    const list = await sessions.list(context(), {});
    expect(list.result.items.map((item) => item.session_id)).toContain(
      ids.empty,
    );
    expect(list.result.items.map((item) => item.session_id)).not.toContain(
      ids.other,
    );
    const repos = await sessions.repos(context(), {});
    expect(JSON.stringify(repos.result)).not.toContain("host/other/repo");
    const installations = await sessions.installations(context(), {});
    expect(installations.result.items).toHaveLength(1);
    const raw = await sessions.raw(context(), ids.public, { limit: 2 });
    expect(raw.result.items.map((row) => row.pos)).toEqual(["0", "1"]);
    const rawNext = await sessions.raw(context(), ids.public, {
      limit: 2,
      cursor: raw.result.cursor,
    });
    expect(rawNext.result.items.map((row) => row.pos)).toEqual(["2", "3"]);
    const schema = await sessions.schema(context());
    expect(
      schema.result.columns.some(
        (column) =>
          column.view_name === "sessions" &&
          column.column_name === "session_id",
      ),
    ).toBe(true);
  });
  it("writes one audit event on successful reads, validation, visibility and permission failures", async () => {
    for (const operation of [
      (ctx: ServiceContext) =>
        query.execute(ctx, { sql: "SELECT count(*) FROM sessions" }),
      (ctx: ServiceContext) =>
        query.execute(ctx, { sql: "SELECT set_config('role','x',true)" }),
      (ctx: ServiceContext) => sessions.get(ctx, { session_id: ids.private }),
      (ctx: ServiceContext) => search.execute(ctx, { query: "", filters: {} }),
    ]) {
      const ctx = context();
      await operation(ctx).catch(() => undefined);
      const audit = await writer.query<{ count: string }>(
        "SELECT count(*) FROM audit_event WHERE request_id=$1",
        [ctx.requestId],
      );
      expect(audit.rows[0]?.count).toBe("1");
    }
    const forbidden = context("org-a", false, false);
    await expect(
      query.execute(forbidden, { sql: "SELECT 1" }),
    ).rejects.toMatchObject({ statusCode: 403, audited: true });
    const rows = await writer.query(
      "SELECT status_code FROM audit_event WHERE request_id=$1",
      [forbidden.requestId],
    );
    expect(rows.rows).toEqual([{ status_code: 403 }]);
  });
  // @req R-SRCH-09 @req R-SRCH-12 @req R-DASH-06
  it("keeps all 30 golden question answers in the top three, including identifier and long failure tails", async () => {
    const golden = z
      .array(
        z.object({
          question: z.string(),
          query: z.string(),
          session: z.string(),
        }),
      )
      .length(30)
      .parse(
        parseYaml(
          await readFile(
            new URL("../../../fixtures/search-golden.yaml", import.meta.url),
            "utf8",
          ),
        ),
      );
    // Warm the database pool and redaction policy cache as on a running instance.
    await search.execute(context(), { query: "warmup" });
    const durations: number[] = [];
    for (const item of golden) {
      const started = performance.now();
      const result = await search.execute(context(), {
        query: item.query,
        filters: { repo_name: "host/team/golden" },
        context: 1,
        limit: 3,
      });
      durations.push(performance.now() - started);
      expect(
        result.result.blocks.map((block) => block.session_id),
        item.question,
      ).toContain(corpusIds.get(item.session));
      expect(
        Buffer.byteLength(JSON.stringify(result.result)),
      ).toBeLessThanOrEqual(32768);
      expect(
        Buffer.byteLength(formatSearch(result.result).text),
      ).toBeLessThanOrEqual(32768);
      expect(formatSearch(result.result).text).not.toContain("rank=");
    }
    durations.sort((left, right) => left - right);
    expect(
      durations[Math.ceil(durations.length * 0.95) - 1],
      "Warm search p95 includes the committed audit write, before browser rendering",
    ).toBeLessThan(1000);
    const tail = await search.execute(context(), {
      query: "TS2322 incompatible",
      context: 0,
    });
    expect(
      tail.result.blocks
        .flatMap((block) => block.messages)
        .some((message) => message.content.includes("TS2322")),
    ).toBe(true);
  });
});

describe("structured search conditions on ClickHouse", () => {
  const visible = randomUUID();
  const hidden = randomUUID();
  const foreign = randomUUID();
  const second = randomUUID();
  const empty = randomUUID();
  const toolName = "mcp__FutureVendor__Search_%\\_'; SELECT 1 --";
  const parameter = "Auth_%\\_'; SELECT pg_sleep(10) --";
  beforeAll(async () => {
    for (const [id, visibility, org] of [
      [visible, "PUBLIC", "org-a"],
      [second, "PUBLIC", "org-a"],
      [hidden, "PRIVATE", "org-a"],
      [foreign, "PUBLIC", "org-b"],
    ]) {
      if (!id || !org || !visibility)
        throw new Error("Missing fixture identity");
      const batch = await session(id, {
        visibility,
        organization: org,
        repo: "host/team/conditions",
        title: "Structured conditions",
      });
      await message(id, batch, 0, "structuredneedle first tool call", {
        org,
        role: "ASSISTANT",
        kind: "TOOL_USE",
        tool: toolName,
        input: {
          padding: "x".repeat(3000),
          query: parameter,
          options: {
            limit: 2,
            enabled: true,
            nothing: null,
            literal: "2",
            paths: ["src/auth.ts"],
            "a.b": { "[key]": "literal key" },
          },
        },
      });
      await message(id, batch, 1, "structuredneedle second tool call", {
        org,
        role: "ASSISTANT",
        kind: "TOOL_USE",
        tool: "UnrelatedTool",
        input: { query: "unrelated", exclusive: "second message" },
      });
    }
    await session(empty, {
      repo: "host/team/conditions",
      title: "Structured conditions",
    });
  });
  async function find(where: unknown[], ctx = context(), extra = {}) {
    return (
      await search.execute(ctx, {
        query: "",
        context: 0,
        filters: { repo_name: "host/team/conditions", where },
        ...extra,
      })
    ).result;
  }
  // @req R-SRCH-13
  it("filters arbitrary live tool names and full parameters with literal case-insensitive matches", async () => {
    const where = [
      {
        field: "tool_name",
        op: "contains",
        value: "FUTUREVENDOR__SEARCH_%\\_'; SELECT 1 --",
      },
      {
        field: "tool_input",
        path: ["query"],
        op: "starts_with",
        value: parameter.toUpperCase(),
      },
    ];
    const result = await find(where);
    expect(result.blocks.map((block) => block.session_id).sort()).toEqual(
      [visible, second].sort(),
    );
    expect(
      result.blocks
        .flatMap((block) => block.messages)
        .map((message) => message.seq),
    ).toEqual([0, 0]);
    expect(
      (
        await find([
          { field: "tool_name", op: "eq", value: toolName.toUpperCase() },
        ])
      ).blocks,
    ).toEqual([]);
    expect(
      (await find([{ field: "tool_name", op: "eq", value: toolName }])).blocks,
    ).toHaveLength(2);
    const lexical = await find(where, context(), { query: "structuredneedle" });
    expect(lexical.blocks.map((block) => block.session_id).sort()).toEqual(
      [visible, second].sort(),
    );
  });
  // @req R-SRCH-13
  it("preserves JSON primitive types, missing/null distinction, array indexes and literal path keys", async () => {
    for (const [path, value, expected] of [
      [["options", "limit"], 2, 2],
      [["options", "limit"], "2", 0],
      [["options", "enabled"], true, 2],
      [["options", "enabled"], "true", 0],
      [["options", "nothing"], null, 2],
      [["options", "missing"], null, 0],
      [["options", "paths", "0"], "src/auth.ts", 2],
      [["options", "paths", "-1"], "src/auth.ts", 2],
      [["options", "paths", "9".repeat(256)], "src/auth.ts", 0],
      [["options", "paths", "-" + "9".repeat(255)], "src/auth.ts", 0],
      [["options", "a.b", "[key]"], "literal key", 2],
    ] as const)
      expect(
        (await find([{ field: "tool_input", path, op: "eq", value }])).blocks,
      ).toHaveLength(expected);
    expect(
      (
        await find([
          { field: "tool_input", path: ["options", "nothing"], op: "exists" },
        ])
      ).blocks,
    ).toHaveLength(2);
    expect(
      (await find([{ field: "tool_input", path: ["options"], op: "exists" }]))
        .blocks,
    ).toHaveLength(2);
    expect(
      (
        await find([
          {
            field: "tool_input",
            path: ["options", "limit"],
            op: "contains",
            value: "2",
          },
        ])
      ).blocks,
    ).toEqual([]);
    expect(
      (await find([{ field: "tool_use_id", op: "eq", value: null }])).blocks,
    ).toHaveLength(2);
    expect(
      (await find([{ field: "tool_use_id", op: "exists" }])).blocks,
    ).toEqual([]);
  });
  // @req R-SRCH-13
  it("requires message conditions on the same call, preserves context and binds cursors", async () => {
    expect(
      (
        await find([
          { field: "tool_name", op: "eq", value: toolName },
          { field: "tool_input", path: ["exclusive"], op: "exists" },
        ])
      ).blocks,
    ).toEqual([]);
    const where = [{ field: "tool_name", op: "eq", value: toolName }];
    const first = await find(where, context(), { limit: 1, context: 1 });
    expect(first.blocks[0]?.messages.map((message) => message.hit)).toEqual([
      true,
      false,
    ]);
    expect(first.cursor).toBeTruthy();
    const next = await find(where, context(), {
      limit: 1,
      context: 1,
      cursor: first.cursor,
    });
    expect(next.blocks[0]?.session_id).not.toBe(first.blocks[0]?.session_id);
    expect(next.cursor).toBeNull();
    await expect(
      find(
        [{ field: "tool_name", op: "contains", value: "Search" }],
        context(),
        { limit: 1, context: 1, cursor: first.cursor },
      ),
    ).rejects.toMatchObject({ code: "INVALID_CURSOR" });
  });
  // @req R-SRCH-13
  it("shares session-list predicates while retaining empty-session, privacy and organization boundaries", async () => {
    const filters = {
      repo_name: "host/team/conditions",
      where: [{ field: "title", op: "starts_with", value: "structured" }],
    };
    const list = await sessions.list(context(), { filters });
    expect(list.result.items.map((item) => item.session_id).sort()).toEqual(
      [visible, second, empty].sort(),
    );
    const messageFilters = {
      ...filters,
      where: [{ field: "tool_name", op: "contains", value: "futurevendor" }],
    };
    const messageList = await sessions.list(context(), {
      filters: messageFilters,
    });
    expect(
      messageList.result.items.map((item) => item.session_id).sort(),
    ).toEqual([visible, second].sort());
    expect(
      (await find(messageFilters.where, context("org-a", true))).blocks
        .map((block) => block.session_id)
        .sort(),
    ).toEqual([visible, second, hidden].sort());
    expect(
      (await find(messageFilters.where, context("org-b", true))).blocks.map(
        (block) => block.session_id,
      ),
    ).toEqual([foreign]);
  });
});
