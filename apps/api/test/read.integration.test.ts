import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { startTraceDatabase } from "../../../packages/traces/test/support.js";
import { TraceFixtures } from "../../../packages/traces/test/fixtures.js";
import {
  ClickHouseError,
  NO_TARGET_SESSION_ID,
  TraceReaders,
} from "@agentcommons/traces";
import {
  messageRowSchema,
  responseBytes,
  type ContentCursor,
  type GetOutput,
  type MessageKind,
} from "@agentcommons/core";
import { formatGet, formatSearch } from "@agentcommons/core/format";
import { claudeCode } from "@agentcommons/core/normalizers";
import { z } from "zod";
import { parse as parseYaml } from "yaml";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Prisma } from "@agentcommons/db";
import { CursorCodec } from "../src/services/cursor.js";
import { QueryService } from "../src/services/query.js";
import { SearchService } from "../src/services/search.js";
import { SessionService } from "../src/services/session.js";
import { requireCaller, type ServiceContext } from "../src/services/context.js";
import { countingReaders, scansPerRelation } from "./query-counter.js";
import {
  releaser,
  syntheticContext,
  syntheticOrganization,
} from "./support.js";

const { defer, release } = releaser();
let writer: Client;
let db: Awaited<ReturnType<typeof startTraceDatabase>>;
let fixtures: TraceFixtures;
let counter: ReturnType<typeof countingReaders>;
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
  wide: randomUUID(),
  second: randomUUID(),
  empty: randomUUID(),
};
const corpusIds = new Map<string, string>();
const context = (
  organizationId = "org-a",
  options?: Parameters<typeof syntheticContext>[1],
) => syntheticContext(organizationId, options);
async function session(
  id: string,
  options: {
    organization?: string;
    visibility?: string;
    parent?: string;
    parentToolUseId?: string;
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
    ...(options.parentToolUseId
      ? { parentToolUseId: options.parentToolUseId }
      : {}),
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
  defer(() => db.close());
  fixtures = new TraceFixtures(db);
  defer(() => fixtures.close());
  writer = new Client({ connectionString: db.urls.migration });
  await writer.connect();
  defer(() => writer.end());
  counter = countingReaders(db.traceReaders);
  const dependencies = {
    prisma: db.prisma,
    readers: counter.readers,
    audit: db.audit,
    cursors: new CursorCodec("integration-cursor-secret-with-enough-entropy"),
  };
  search = new SearchService(dependencies);
  sessions = new SessionService(dependencies);
  query = new QueryService(dependencies);
  for (const organizationId of ["org-a", "org-b"])
    await syntheticOrganization(db, {
      organizationId,
      keyId: organizationId === "org-a" ? "key-a" : "key-b",
      installationId,
    });
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
  // Sixty 1 KB messages: more than one 32 KB page, well within one 256 KB page.
  const wide = await session(ids.wide, { title: "Wide page fixture" });
  for (let seq = 0; seq < 60; seq++)
    await message(
      ids.wide,
      wide,
      seq,
      `wide message ${String(seq)} ${"w".repeat(1024)}`,
      { role: seq % 2 ? "ASSISTANT" : "USER" },
    );
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
afterAll(release);

/** The 30 golden questions and the corpus session each must surface. */
async function goldenQuestions() {
  return z
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
}
function goldenSearch(item: { query: string }) {
  return search.execute(context(), {
    query: item.query,
    filters: { repo_name: "host/team/golden" },
    context: 1,
    limit: 3,
  });
}

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
  // @req R-SRCH-15
  it("places a truncated excerpt with its UTF-8 byte range and marks the cut ends in the agent text", async () => {
    const id = randomUUID();
    const batch = await session(id, { repo: "host/team/excerpt" });
    // 350 emoji (4 bytes each) after the marker: the excerpt keeps the first 300 code points.
    await message(id, batch, 0, `rangemarker ${"🙂".repeat(350)}`);
    // The marker as its own word at code point 201 of 700 ASCII characters (bytes equal
    // code points here): the window opens 100 before it.
    await message(
      id,
      batch,
      1,
      `${"a".repeat(200)} rangemarker ${"b".repeat(487)}`,
    );
    const page = await search.execute(context(), {
      query: "rangemarker",
      filters: { repo_name: "host/team/excerpt" },
      context: 0,
      limit: 5,
      cursor: null,
    });
    const messages = page.result.blocks.flatMap((block) => block.messages);
    const head = messages.find((item) => item.seq === 0);
    const middle = messages.find((item) => item.seq === 1);
    if (!head || !middle) throw new Error("both hits are on the page");
    expect(head.truncated).toBe(true);
    expect(head.content_range).toEqual({
      start: 0,
      end: 12 + 288 * 4,
      total: 12 + 350 * 4,
    });
    expect(Buffer.byteLength(head.content)).toBe(12 + 288 * 4);
    expect(middle.content_range).toEqual({ start: 101, end: 401, total: 700 });
    expect(middle.content.startsWith("a".repeat(99) + " rangemarker ")).toBe(
      true,
    );
    const text = formatSearch(page.result).text;
    expect(text).toContain(
      `[hit] [truncated 0-${String(12 + 288 * 4)} of ${String(12 + 350 * 4)}]\nrangemarker `,
    );
    expect(text).toContain(
      "[hit] [truncated 101-401 of 700]\n…" + "a".repeat(99),
    );
    expect(text).toContain("b".repeat(188) + "…");
    // A short message is complete: no range, no markers.
    await message(id, batch, 2, "rangemarker short");
    const again = await search.execute(context(), {
      query: "rangemarker short",
      filters: { repo_name: "host/team/excerpt" },
      context: 0,
      limit: 5,
      cursor: null,
    });
    const short = again.result.blocks
      .flatMap((block) => block.messages)
      .find((item) => item.seq === 2);
    expect(short?.truncated).toBe(false);
    expect(short?.content_range).toBeNull();
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
    expect(root.result.header?.children).toEqual([]);
    expect(root.result.header?.input_tokens).toBe("9007199254740993");
    expect(root.result.messages.map((row) => row.kind)).toEqual([
      "THINKING",
      "TEXT",
    ]);
    const child = await sessions.get(context(), { session_id: ids.child });
    expect(child.result.header?.parent).toBeNull();
    expect(child.result.header?.root_session_id).toBe(ids.child);
    const first = await sessions.get(context(), { session_id: ids.long });
    // One slice is a quarter of the 32 KB page.
    expect(Buffer.byteLength(first.result.messages[0]?.content ?? "")).toBe(
      8192,
    );
    // The bounded first message does not end the page: the tool call follows it, and
    // the rest of each waits behind its own content_cursor; next continues the range's
    // last message because the range ends inside it.
    expect(first.result.messages[0]?.content_cursor).toEqual({
      seq: 0,
      offset: 8192,
    });
    expect(first.result.messages.map((row) => row.seq)).toEqual([0, 1]);
    expect(first.result.next).toEqual(first.result.messages[1]?.content_cursor);
    const next = await sessions.get(context(), {
      session_id: ids.long,
      from: 0,
      to: 0,
      cursor: first.result.messages[0]?.content_cursor,
    });
    expect(next.result.next).toEqual({ seq: 0, offset: 16384 });
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
  // @req R-DASH-39 @req R-GET-02
  it("raises the page budget for REST readers without widening visibility or the agent default", async () => {
    const wide = 60;
    const small = (await sessions.get(context(), { session_id: ids.wide }))
      .result;
    expect(small.messages.length).toBeLessThan(wide);
    expect(small.next).not.toBeNull();
    const page = (
      await sessions.get(context(), {
        session_id: ids.wide,
        page_bytes: 262144,
      })
    ).result;
    expect(page.messages.map((row) => row.seq)).toEqual(
      Array.from({ length: wide }, (_, seq) => seq),
    );
    expect(page.next).toBeNull();
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(262144);
    // A message slice grows with the budget: a quarter of the page.
    const slice = (
      await sessions.get(context(), {
        session_id: ids.long,
        page_bytes: 262144,
      })
    ).result;
    expect(Buffer.byteLength(slice.messages[0]?.content ?? "")).toBe(65536);
    expect(slice.messages[0]?.content).not.toContain("�");
    expect(slice.messages[0]?.content_cursor).toEqual({
      seq: 0,
      offset: 65536,
    });
    // The 12 KB tool call fits a 64 KB slice whole, so the range is complete.
    expect(slice.messages[1]?.content_cursor).toBeNull();
    expect(slice.next).toBeNull();
    // A caller that holds the header reads messages only: same rows, no header, and the
    // visibility answer unchanged.
    const light = (
      await sessions.get(context(), {
        session_id: ids.wide,
        page_bytes: 262144,
        header: false,
      })
    ).result;
    expect(light.header).toBeNull();
    expect(light.messages).toEqual(page.messages);
    expect(light.next).toBeNull();
    expect(formatGet(light).text.startsWith("seq 0 USER TEXT")).toBe(true);
    // The budget is bounded, and neither it nor the header switch widens what a caller may see.
    for (const page_bytes of [32767, 262145])
      await expect(
        sessions.get(context(), { session_id: ids.wide, page_bytes }),
      ).rejects.toMatchObject({ statusCode: 400 });
    for (const id of [ids.private, ids.other])
      for (const header of [true, false])
        await expect(
          sessions.get(context(), {
            session_id: id,
            page_bytes: 262144,
            header,
          }),
        ).rejects.toMatchObject({ statusCode: 404 });
  });
  // @req R-GET-05 @req R-GET-02
  it("reads a captured 16-turn Claude Code session as one bounded preview per message in few pages", async () => {
    // The sanitized parent transcript, 16 turns: 18 messages per turn, ten of them
    // housekeeping attachments (14 KB deferred tools, 7 KB skill listing, reminders).
    const turn = claudeCode.toMessages(
      (
        await readFile(
          new URL(
            "../../../fixtures/transcripts/claude-code/parent.jsonl",
            import.meta.url,
          ),
          "utf8",
        )
      )
        .trim()
        .split("\n")
        .map((line, index) => ({
          id: randomUUID(),
          pos: BigInt(index),
          key: null,
          sourceVersion: 0,
          payload: JSON.parse(line) as Record<string, unknown>,
          receivedAt: new Date(),
        })),
    );
    expect(turn).toHaveLength(18);
    const id = randomUUID();
    // Its own repository keeps it out of the totals other tests count.
    const batch = await session(id, {
      title: "Captured sixteen turns",
      repo: "host/team/captured",
    });
    const turns = 16;
    const received = new Date("2026-08-15T00:00:00Z");
    for (let index = 0; index < turns; index++)
      for (const [offset, item] of turn.entries())
        await fixtures.insert("messages", id, {
          message_id: randomUUID(),
          raw_record_id: randomUUID(),
          ingest_batch_id: batch,
          seq: index * turn.length + offset,
          block_index: 0,
          role: item.role,
          kind: item.kind,
          content: item.content,
          tool_name: item.toolName,
          tool_input: JSON.stringify(item.toolInput),
          searchable: !["THINKING", "META"].includes(item.kind),
          search_text: item.content.slice(0, 2048),
          timestamp: "2026-08-15T00:00:00Z",
          received_at: received,
          input_tokens: null,
          output_tokens: null,
        });
    await fixtures.update("sessions", id, {
      message_count: turns * turn.length,
    });
    const every = Array.from({ length: turns * turn.length }, (_, seq) => seq);
    const metaSeqs = new Set(
      every.filter((seq) => turn[seq % turn.length]?.kind === "META"),
    );
    // Walks every page of one read and returns the seqs seen and the page count.
    const walk = async (input: { kinds?: MessageKind[] }) => {
      const seen: number[] = [];
      let pages = 0;
      let cursor: ContentCursor | null = null;
      do {
        const page: GetOutput = (
          await sessions.get(context(), { session_id: id, cursor, ...input })
        ).result;
        pages++;
        for (const row of page.messages) {
          seen.push(row.seq);
          if (row.kind === "META")
            expect(Buffer.byteLength(row.content)).toBeLessThanOrEqual(1024);
          else expect(row.content_cursor).toBeNull();
        }
        expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(
          32768,
        );
        expect(
          Buffer.byteLength(
            formatGet(page, { continuation: cursor !== null }).text,
          ),
        ).toBeLessThanOrEqual(32768);
        cursor = page.next;
      } while (cursor !== null);
      return { seen, pages };
    };
    // The default read is the conversation: META housekeeping is left out, seq keeps
    // every kind's position, and the header still counts every message.
    const conversation = await walk({});
    expect(conversation.seen).toEqual(
      every.filter((seq) => !metaSeqs.has(seq)),
    );
    expect(conversation.pages).toBeLessThanOrEqual(4);
    const header = (await sessions.get(context(), { session_id: id })).result
      .header;
    expect(header?.message_count).toBe(turns * turn.length);
    // Naming META reads everything, each attachment as a 1 KB preview.
    const everything = await walk({
      kinds: ["TEXT", "THINKING", "TOOL_USE", "TOOL_RESULT", "META"],
    });
    expect(everything.seen).toEqual(every);
    expect(everything.pages).toBeLessThanOrEqual(12);
    const onlyMeta = (
      await sessions.get(context(), { session_id: id, kinds: ["META"] })
    ).result;
    expect(onlyMeta.messages.every((row) => row.kind === "META")).toBe(true);
    expect(onlyMeta.messages[0]?.seq).toBe([...metaSeqs][0]);
    // The export is a file: every kind, every attachment whole.
    const exported = await sessions.export(context(), {
      session_id: id,
      format: "csv",
    });
    const rows = [];
    for await (const row of exported.rows) rows.push(row);
    expect(rows).toHaveLength(turns * turn.length);
    const largest = Math.max(
      ...turn.map((item) => Buffer.byteLength(item.content)),
    );
    expect(Math.max(...rows.map((row) => Buffer.byteLength(row.content)))).toBe(
      largest,
    );
  }, 120_000);
  // @req R-DASH-38
  it("exports every message of a range as one row each, rejoining pages under the same get audit and visibility", async () => {
    const collect = async (ctx: ServiceContext, input: unknown) => {
      const output = await sessions.export(ctx, input);
      const rows = [];
      for await (const row of output.rows) rows.push(row);
      return { columns: output.columns, rows };
    };
    const columns = Object.keys(messageRowSchema.shape);
    const whole = await collect(context(), {
      session_id: ids.public,
      format: "csv",
    });
    expect(whole.columns).toEqual(columns);
    expect(columns).not.toContain("content_cursor");
    // One page holds the whole session: the rows are its messages, field for field.
    const page = (await sessions.get(context(), { session_id: ids.public }))
      .result;
    expect(page.next).toBeNull();
    expect(whole.rows).toEqual(
      page.messages.map((message) =>
        Object.fromEntries(
          columns.map((column) => [
            column,
            message[column as keyof typeof message],
          ]),
        ),
      ),
    );
    expect(whole.rows.map((row) => row.seq)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    // A message that spans pages is one row whose content is its slices in order, and
    // every page the export walked is a `get` read of the same request marked as CSV at
    // the REST page cap, however small a page the caller asked for.
    const ctx = context();
    // The 1 MB thinking message spans several pages even at the 256 KB export page.
    const range = { session_id: ids.long, from: 0, to: 0 };
    const spanning = await collect(ctx, {
      ...range,
      format: "csv",
      page_bytes: responseBytes.read,
    });
    const slices: string[] = [];
    let pages = 0;
    let next: ContentCursor | null = null;
    do {
      const step: GetOutput = (
        await sessions.get(context(), {
          ...range,
          cursor: next,
          page_bytes: responseBytes.page,
          header: next === null,
        })
      ).result;
      slices.push(...step.messages.map((message) => message.content));
      next = step.next;
      pages++;
    } while (next !== null);
    expect(pages).toBeGreaterThan(1);
    expect(spanning.rows).toHaveLength(1);
    expect(spanning.rows[0]?.seq).toBe(0);
    expect(spanning.rows[0]?.content).toBe(slices.join(""));
    const audits = await writer.query<{
      action: string;
      format: string | null;
      page_bytes: string | null;
      header: string | null;
    }>(
      "SELECT action, detail->'input'->>'format' AS format, detail->'input'->>'page_bytes' AS page_bytes, detail->'input'->>'header' AS header FROM audit_event WHERE request_id=$1",
      [ctx.requestId],
    );
    expect(audits.rows).toHaveLength(pages);
    expect(
      new Set(audits.rows.map((row) => `${row.action}:${row.format ?? ""}`)),
    ).toEqual(new Set(["get:csv"]));
    expect(new Set(audits.rows.map((row) => row.page_bytes))).toEqual(
      new Set([String(responseBytes.page)]),
    );
    expect(audits.rows.filter((row) => row.header === "true")).toHaveLength(1);
    // The refusal a JSON read gets is the refusal the export gets, before any row.
    await expect(
      sessions.export(context(), { session_id: ids.private }),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      sessions.export(context("org-a", { read: false }), {
        session_id: ids.public,
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    const empty = await collect(context(), { session_id: ids.empty });
    expect(empty.rows).toEqual([]);
    expect(empty.columns).toEqual(columns);
  });
  // @req R-DASH-11
  it("lists root sessions only on request and carries caller-visible child counts", async () => {
    const listed = (page: { result: { items: { session_id: string }[] } }) =>
      page.result.items.map((item) => item.session_id);
    const filters = { repo_name: "host/team/repo" };
    const everything = await sessions.list(context(), { filters, limit: 100 });
    expect(listed(everything)).toEqual(
      expect.arrayContaining([ids.public, ids.child, ids.leaf]),
    );
    const roots = await sessions.list(context(), {
      filters,
      limit: 100,
      roots_only: true,
    });
    // The child of a hidden parent is a visible root for members; its own child is not.
    expect(listed(roots)).toEqual(
      expect.arrayContaining([ids.public, ids.child]),
    );
    expect(listed(roots)).not.toContain(ids.leaf);
    expect(listed(roots)).not.toContain(ids.private);
    const byId = new Map(
      roots.result.items.map((item) => [item.session_id, item]),
    );
    expect(byId.get(ids.child)?.child_count).toBe(1);
    expect(byId.get(ids.public)?.child_count).toBe(0);
    const adminRoots = await sessions.list(context("org-a", { admin: true }), {
      filters,
      limit: 100,
      roots_only: true,
    });
    expect(listed(adminRoots)).toContain(ids.public);
    expect(listed(adminRoots)).not.toContain(ids.private);
    expect(listed(adminRoots)).not.toContain(ids.child);
    expect(
      adminRoots.result.items.find((item) => item.session_id === ids.public)
        ?.child_count,
    ).toBe(1);
    const formatted = formatGet(
      (await sessions.get(context(), { session_id: ids.child })).result,
    ).text;
    expect(formatted).toContain("subagent_runs: 1");
    expect(formatted).toContain(ids.leaf);
  });
  // @req R-DASH-41
  it("sorts the list by message count in both directions with a session_id tie-break that cursors continue", async () => {
    type Item = { session_id: string; message_count: number };
    const list = (input: Record<string, unknown>) =>
      sessions.list(context(), { sort: "message_count", ...input });
    /** Session ids per count in list order: the tie-break is `session_id` whichever way the count runs. */
    const ties = (items: Item[]) => {
      const groups = new Map<number, string[]>();
      for (const item of items)
        groups.set(item.message_count, [
          ...(groups.get(item.message_count) ?? []),
          item.session_id,
        ]);
      return groups;
    };
    const whole: Record<"asc" | "desc", Item[]> = { asc: [], desc: [] };
    for (const order of ["desc", "asc"] as const) {
      const page = await list({ order, limit: 100 });
      expect(page.result.cursor).toBeNull();
      const items: Item[] = page.result.items;
      whole[order] = items;
      expect(items.length).toBeGreaterThan(3);
      const counts = items.map((item) => item.message_count);
      expect(counts).toEqual(
        [...counts].sort((left, right) =>
          order === "asc" ? left - right : right - left,
        ),
      );
      // Ties are real: the fixture holds several one-message sessions.
      expect(new Set(counts).size).toBeLessThan(counts.length);
      // Pages of three walk the same order without a repeated or skipped row.
      const paged: Item[] = [];
      let cursor: string | null = null;
      do {
        const next = await list({ order, limit: 3, cursor });
        expect(next.result.items.length).toBeLessThanOrEqual(3);
        expect(next.result.total).toEqual(page.result.total);
        paged.push(...next.result.items);
        cursor = next.result.cursor;
      } while (cursor !== null);
      expect(paged).toEqual(items);
    }
    // Reversing the count keeps one session_id order inside every group of equal counts.
    expect(ties(whole.asc)).toEqual(ties(whole.desc));
    expect(whole.asc.map((item) => item.session_id)).not.toEqual(
      whole.desc.map((item) => item.session_id),
    );
    // The cursor is bound to its sort and order; another sort cannot reuse it.
    const first = await list({ order: "desc", limit: 3 });
    await expect(
      list({ order: "asc", limit: 3, cursor: first.result.cursor }),
    ).rejects.toMatchObject({ code: "INVALID_CURSOR" });
    await expect(
      sessions.list(context(), {
        sort: "started_at",
        order: "desc",
        limit: 3,
        cursor: first.result.cursor,
      }),
    ).rejects.toMatchObject({ code: "INVALID_CURSOR" });
  });
  // @req R-DASH-42
  it("lists and sorts sessions by their attributed searches and reads of earlier sessions from the page's own scan", async () => {
    const at = Date.now();
    const read = (
      sessionId: string,
      action: string,
      targetId: string,
      offset: number,
    ) => ({
      organization_id: "org-a",
      session_id: sessionId,
      audit_id: randomUUID(),
      read_at: new Date(at + offset * 60_000),
      action,
      target_session_id: targetId,
      reader_user_id: "owner",
      reader_email: "owner@example.com",
      reader_harness: "CLAUDE_CODE",
    });
    // The public root searched twice; the wide session read the public root twice, the
    // private session once and itself once; every other session did neither.
    await db.traces.appendSessionReads([
      read(ids.public, "search", NO_TARGET_SESSION_ID, 0),
      read(ids.public, "sql", NO_TARGET_SESSION_ID, 1),
      read(ids.wide, "get", ids.public, 2),
      read(ids.wide, "get", ids.public, 3),
      read(ids.wide, "get", ids.private, 4),
      read(ids.wide, "get", ids.wide, 5),
    ]);
    type Item = {
      session_id: string;
      agentcommons_search_calls: number;
      reuses_made: number;
      reuse_count: number;
    };
    type Listed = { result: { items: Item[]; total: { sessions: number } } };
    const listed = (page: Listed) =>
      page.result.items.map((item) => item.session_id);
    const list = (input: Record<string, unknown>, ctx = context()) =>
      sessions.list(ctx, { limit: 100, ...input }) as Promise<Listed>;
    const byId = (page: Listed) =>
      new Map(page.result.items.map((item) => [item.session_id, item]));
    const everything = byId(await list({}));
    expect(everything.get(ids.public)).toMatchObject({
      agentcommons_search_calls: 2,
      reuses_made: 0,
      reuse_count: 1,
    });
    // Distinct sessions read: the self read is none, and a member cannot see the private target.
    expect(everything.get(ids.wide)).toMatchObject({
      agentcommons_search_calls: 0,
      reuses_made: 1,
    });
    expect(everything.get(ids.empty)).toMatchObject({
      agentcommons_search_calls: 0,
      reuses_made: 0,
    });
    const admin = context("org-a", { admin: true });
    expect(byId(await list({}, admin)).get(ids.wide)?.reuses_made).toBe(2);
    // Each filter keeps only the sessions with, or only those without, the usage; the
    // totals follow the same predicate and the two filters compose with the others.
    const searched = await list({ searched: true });
    expect(listed(searched)).toEqual([ids.public]);
    expect(searched.result.total.sessions).toBe(1);
    const unsearched = await list({ searched: false });
    expect(listed(unsearched)).not.toContain(ids.public);
    expect(listed(unsearched)).toEqual(
      expect.arrayContaining([ids.wide, ids.empty]),
    );
    expect(unsearched.result.total.sessions).toBe(
      everything.size - searched.result.total.sessions,
    );
    const used = await list({ used_prior_work: true });
    expect(listed(used)).toEqual([ids.wide]);
    expect(listed(await list({ used_prior_work: false }))).toEqual(
      expect.arrayContaining([ids.public, ids.empty]),
    );
    expect(
      listed(await list({ searched: true, used_prior_work: true })),
    ).toEqual([]);
    expect(
      listed(
        await list({
          searched: false,
          used_prior_work: false,
          filters: { repo_name: "host/team/repo" },
          roots_only: true,
        }),
      ),
    ).not.toContain(ids.public);
    // Both aggregates sort on the server; the first page of a filtered list is one scan.
    const bySearch = await list({ sort: "agentcommons_search_calls" });
    expect(listed(bySearch)[0]).toBe(ids.public);
    const byReuse = await list({ sort: "reuses_made", order: "desc" });
    expect(listed(byReuse)[0]).toBe(ids.wide);
    const ascending = await list({ sort: "reuses_made", order: "asc" });
    expect(listed(ascending).at(-1)).toBe(ids.wide);
    counter.drain();
    await list({ searched: true, limit: 1 });
    expect(scansPerRelation(counter.drain())).toEqual({
      sessions: 1,
      session_details: 1,
    });
    // The header carries both counts, in JSON and in the text form agents read.
    const got = await sessions.get(context(), { session_id: ids.public });
    expect(got.result.header).toMatchObject({
      agentcommons_search_calls: 2,
      reuses_made: 0,
    });
    expect(formatGet(got.result).text).toContain(
      "agentcommons_search_calls: 2",
    );
    expect(formatGet(got.result).text).toContain("reuses_made: 0");
  });
  // @req R-DASH-37 @req R-SRCH-17
  it("reports session, message and hit totals over the whole visible set beside every page", async () => {
    const filters = { repo_name: "host/team/repo" };
    type Listed = {
      result: { items: { session_id: string; message_count: number }[] };
    };
    const listed = (page: Listed) =>
      page.result.items.map((item) => item.session_id);
    const messages = (page: Listed) =>
      page.result.items.reduce((sum, item) => sum + item.message_count, 0);
    const totalOf = (page: Listed) => ({
      sessions: page.result.items.length,
      messages: messages(page),
    });
    const list = (input: Record<string, unknown>, ctx = context()) =>
      sessions.list(ctx, { filters, limit: 100, ...input });
    // The totals come from every matching session, never from the page window.
    const everything = await list({});
    const page = await list({ limit: 1 });
    expect(page.result.items).toHaveLength(1);
    expect(page.result.cursor).not.toBeNull();
    expect(page.result.total.sessions).toBeGreaterThan(1);
    expect(page.result.total).toEqual(totalOf(everything));
    // roots_only narrows the totals exactly as it narrows the rows.
    const roots = await list({ roots_only: true });
    expect((await list({ limit: 1, roots_only: true })).result.total).toEqual(
      totalOf(roots),
    );
    expect(roots.result.items.length).toBeLessThan(
      everything.result.items.length,
    );
    // A message filter counts the whole matching sessions and all of their messages.
    const bash = await list({ filters: { ...filters, tool_name: "Bash" } });
    expect(listed(bash)).toEqual(expect.arrayContaining([ids.leaf, ids.long]));
    expect(
      (await list({ filters: { ...filters, tool_name: "Bash" }, limit: 1 }))
        .result.total,
    ).toEqual(totalOf(bash));
    // A member's totals never count the hidden session; an admin's do.
    expect(listed(everything)).not.toContain(ids.private);
    const admin = context("org-a", { admin: true });
    const adminAll = await list({}, admin);
    expect(listed(adminAll)).toContain(ids.private);
    expect((await list({ limit: 1 }, admin)).result.total).toEqual(
      totalOf(adminAll),
    );
    expect(adminAll.result.items.length).toBeGreaterThan(
      everything.result.items.length,
    );
    // Another organization's totals never see these sessions.
    expect((await list({ limit: 1 }, context("org-b"))).result.total).toEqual({
      sessions: 0,
      messages: 0,
    });
    // Search totals count every hit before the per-session cap, the cursor and the limit:
    // four public root messages plus the public child; the private session only for admins.
    const find = (ctx = context(), extra = {}) =>
      search.execute(ctx, {
        query: "circuit breaker",
        filters,
        context: 0,
        limit: 1,
        ...extra,
      });
    const found = await find();
    expect(found.result.blocks).toHaveLength(1);
    expect(found.result.cursor).not.toBeNull();
    expect(found.result.total).toEqual({ sessions: 2, hits: 5 });
    expect(
      formatSearch(found.result).text.startsWith("5 hits in 2 sessions\n"),
    ).toBe(true);
    expect(
      (await find(context(), { cursor: found.result.cursor })).result.total,
    ).toEqual(found.result.total);
    expect((await find(admin)).result.total).toEqual({ sessions: 3, hits: 6 });
    // A page with hits carries no next step; a page without one says what to try,
    // shaped by the call (two words with filters: check the filters) (R-SRCH-17).
    expect(found.result.next).toBeNull();
    const missed = await find(context("org-b"));
    expect(missed.result.total).toEqual({ sessions: 0, hits: 0 });
    expect(missed.result.next).toContain("Retry without the filters");
    expect(formatSearch(missed.result).text).toBe(
      `0 hits in 0 sessions\n\nNext: ${missed.result.next ?? ""}`,
    );
    // An empty query counts the non-thinking messages of the matching sessions.
    expect(
      (
        await search.execute(context(), {
          query: "",
          filters: { session_id: ids.public },
          context: 0,
          limit: 1,
        })
      ).result.total,
    ).toEqual({ sessions: 1, hits: 4 });
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
      code: "QUERY_MEMORY_LIMIT",
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
    expect(failure.code).toBe("QUERY_INVALID");
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
      code: "QUERY_INVALID",
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
  // @req R-LNK-07 @req R-GET-01
  it("carries a child's spawning tool call through the header, child references and tree", async () => {
    const parent = randomUUID();
    const nested = randomUUID();
    const listed = randomUUID();
    const toolUseId = `redacted-${"b".repeat(64)}`;
    await session(parent, { title: "Spawning parent" });
    await session(nested, { parent, parentToolUseId: toolUseId });
    await session(listed, { parent });
    const page = await sessions.get(context(), { session_id: parent });
    expect(page.result.header?.parent_tool_use_id).toBeNull();
    expect(
      page.result.header?.children.map((child) => [
        child.session_id,
        child.parent_tool_use_id,
      ]),
    ).toEqual(
      expect.arrayContaining([
        [nested, toolUseId],
        [listed, null],
      ]),
    );
    const child = await sessions.get(context(), { session_id: nested });
    expect(child.result.header?.parent_tool_use_id).toBe(toolUseId);
    const tree = await sessions.tree(context(), parent, {});
    expect(
      tree.result.nodes.find((node) => node.session_id === nested)
        ?.parent_tool_use_id,
    ).toBe(toolUseId);
    const rows = await query.execute(context(), {
      sql: `SELECT parent_tool_use_id FROM sessions WHERE session_id='${nested}'`,
    });
    expect(rows.result.rows).toEqual([[toolUseId]]);
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
    expect(page.result.header?.child_count).toBe(12);
    expect(page.result.header?.children).toHaveLength(10);
    expect(page.result.header?.children_truncated).toBe(true);
    expect(page.result.header?.truncated_fields).toEqual(
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
  // @req R-LNK-06 @req R-ORG-07 @req R-DASH-30
  it("isolates every read surface and returns hidden-node gaps without hidden facts", async () => {
    const sql = await query.execute(context(), {
      sql: "SELECT session_id FROM sessions",
    });
    expect(sql.result.rows.flat()).not.toContain(ids.private);
    expect(sql.result.rows.flat()).not.toContain(ids.other);
    const admin = await query.execute(context("org-a", { admin: true }), {
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
    const adminTree = await sessions.tree(
      context("org-a", { admin: true }),
      ids.leaf,
    );
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
    const forbidden = context("org-a", { read: false });
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
    const golden = await goldenQuestions();
    // Warm the database pool and redaction policy cache as on a running instance.
    await search.execute(context(), { query: "warmup" });
    for (const item of golden) {
      const result = await goldenSearch(item);
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
  // @req R-DASH-37 @req R-GET-01 @req R-GET-04 @req R-LNK-06
  it("scans each relation at most once per read request and takes totals from the page's own scan", async () => {
    const scans = async (run: () => Promise<unknown>) => {
      counter.drain();
      await run();
      return counter.drain();
    };
    const perRelation = async (run: () => Promise<unknown>) =>
      scansPerRelation(await scans(run));
    for (const ctx of [context(), context("org-a", { admin: true })]) {
      // get: the header row with its parent and children, the metadata and the payloads
      // are three queries; the header query also answers visibility.
      expect(
        await perRelation(() => sessions.get(ctx, { session_id: ids.child })),
      ).toEqual({
        sessions: 1,
        session_details: 1,
        message_metadata: 1,
        messages: 1,
      });
      expect(
        await perRelation(() =>
          sessions.get(ctx, { session_id: ids.child, header: false }),
        ),
      ).toEqual({ session_state: 1, message_metadata: 1, messages: 1 });
      // list: rows and totals come from one scan of `sessions`, relatives from one of
      // `session_details`; a message filter narrows inside the same query through the
      // metadata relation.
      expect(await perRelation(() => sessions.list(ctx, { limit: 2 }))).toEqual(
        { sessions: 1, session_details: 1 },
      );
      expect(
        await perRelation(() =>
          sessions.list(ctx, {
            limit: 2,
            roots_only: true,
            filters: { tool_name: "Bash", repo_name: "host/team/repo" },
          }),
        ),
      ).toEqual({ sessions: 1, message_metadata: 1, session_details: 1 });
      // tree: control walks the graph; one ClickHouse scan presents the visible nodes and
      // answers whether the requested session is visible.
      expect(await perRelation(() => sessions.tree(ctx, ids.leaf))).toEqual({
        session_details: 1,
      });
      // reuse: the edge page carries both titles and its snapshot clock in one query.
      expect(
        await perRelation(() =>
          sessions.reuse(ctx, ids.public, { direction: "by" }),
        ),
      ).toEqual({ reuse_edges: 1, session_details: 1, session_state: 1 });
      // search: one candidate scan carries the totals; context, headers and payloads
      // read only the page's session and message ids afterwards.
      const searched = await scans(() =>
        search.execute(ctx, {
          query: "circuit breaker",
          filters: { repo_name: "host/team/repo" },
          context: 1,
          limit: 5,
        }),
      );
      expect(searched).toHaveLength(4);
      expect(
        searched.filter((entry) => entry.relations.includes("search_messages")),
      ).toHaveLength(1);
      expect(
        searched
          .slice(1)
          .every((entry) => /\{(ids|sessions):Array\(UUID\)\}/.test(entry.sql)),
      ).toBe(true);
    }
    // A member's continuation cursor past the last hit still reports the totals.
    const page = await search.execute(context(), {
      query: "circuit breaker",
      filters: { repo_name: "host/team/repo" },
      context: 0,
      limit: 5,
    });
    expect(page.result.cursor).toBeNull();
    expect(page.result.total).toEqual({ sessions: 2, hits: 5 });
  });
});

/** Wall-clock measurement on shared hardware: run with BENCHMARK=1. */
describe.skipIf(!process.env.BENCHMARK)("warm search latency", () => {
  it("answers the golden questions with a warm p95 under a second", async () => {
    const golden = await goldenQuestions();
    await search.execute(context(), { query: "warmup" });
    const durations: number[] = [];
    for (const item of golden) {
      const started = performance.now();
      await goldenSearch(item);
      durations.push(performance.now() - started);
    }
    durations.sort((left, right) => left - right);
    expect(
      durations[Math.ceil(durations.length * 0.95) - 1],
      "Warm search p95 includes the committed audit write, before browser rendering",
    ).toBeLessThan(1000);
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
      (
        await find(messageFilters.where, context("org-a", { admin: true }))
      ).blocks
        .map((block) => block.session_id)
        .sort(),
    ).toEqual([visible, second, hidden].sort());
    expect(
      (
        await find(messageFilters.where, context("org-b", { admin: true }))
      ).blocks.map((block) => block.session_id),
    ).toEqual([foreign]);
  });
});

// @req R-GET-07 @req R-SQL-07 @req R-AUD-01
it("maps trace read limits and busy databases to stable retryable codes on search, get and sql, and leaves unexpected failures as OPERATION_FAILED", async () => {
  const failing = (error: unknown) =>
    vi.spyOn(counter.readers, "read").mockRejectedValueOnce(error);
  const requestId = randomUUID();
  const scoped = (): ServiceContext => ({ ...context(), requestId });
  try {
    // A first-page search makes one bounded attempt after a time limit (R-SRCH-16), so
    // the documented failure needs both reads to time out.
    for (let attempt = 0; attempt < 2; attempt += 1)
      failing(
        new ClickHouseError({
          code: "159",
          type: "TIMEOUT_EXCEEDED",
          message: "Timeout exceeded: elapsed 5.01 s (query: SELECT secret)",
        }),
      );
    const timedOut: unknown = await search
      .execute(scoped(), { query: "circuit breaker", context: 0 })
      .catch((error: unknown) => error);
    expect(timedOut).toMatchObject({
      statusCode: 503,
      code: "READ_TIME_LIMIT",
      detail: { retry_after: 5 },
      audited: true,
    });
    const timedOutMessage = z.object({ message: z.string() }).parse(timedOut);
    expect(timedOutMessage.message).toContain("5 second");
    expect(timedOutMessage.message).toContain("search_messages(q=");
    expect(timedOutMessage.message).not.toContain("secret");
    failing(
      new Prisma.PrismaClientKnownRequestError("Raw query failed", {
        code: "P2010",
        clientVersion: "test",
        meta: {
          code: "55P03",
          message: "canceling statement due to lock timeout",
        },
      }),
    );
    await expect(
      sessions.get(scoped(), { session_id: ids.long }),
    ).rejects.toMatchObject({
      statusCode: 503,
      code: "READ_BUSY",
      detail: { retry_after: 5 },
      audited: true,
    });
    failing(
      new ClickHouseError({
        code: "241",
        type: "MEMORY_LIMIT_EXCEEDED",
        message: "Memory limit (for query) exceeded",
      }),
    );
    await expect(
      query.execute(scoped(), { sql: "SELECT count() FROM messages" }),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "QUERY_MEMORY_LIMIT",
      detail: { position: null },
      audited: true,
    });
    failing(new Error("unexpected reader failure"));
    await expect(
      sessions.get(scoped(), { session_id: ids.long }),
    ).rejects.toMatchObject({
      statusCode: 500,
      code: "OPERATION_FAILED",
      audited: true,
    });
  } finally {
    vi.restoreAllMocks();
  }
  // Every failure is audited before it is thrown, with its stable code in the detail.
  const audited = await db.prisma.auditEvent.findMany({
    where: { requestId },
    orderBy: { ts: "asc" },
  });
  expect(
    audited.map((row) => [
      row.action,
      row.statusCode,
      z.object({ code: z.string() }).loose().parse(row.detail).code,
    ]),
  ).toEqual([
    ["search", 503, "READ_TIME_LIMIT"],
    ["get", 503, "READ_BUSY"],
    ["sql", 400, "QUERY_MEMORY_LIMIT"],
    ["get", 500, "OPERATION_FAILED"],
  ]);
  // The reader is intact once the databases answer again.
  expect(
    (await sessions.get(context(), { session_id: ids.long })).result.header,
  ).not.toBeNull();
});
