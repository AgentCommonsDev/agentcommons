import { cleanup as cleanupAll } from "../../../scripts/cleanup.js";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { Client } from "pg";
import { PrismaClient, ReaderPools } from "@agentcommons/db";
import { formatGet, formatSearch } from "@agentcommons/core/format";
import { z } from "zod";
import { parse as parseYaml } from "yaml";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuditService } from "../src/services/audit.js";
import { CursorCodec } from "../src/services/cursor.js";
import { QueryService } from "../src/services/query.js";
import { SearchService } from "../src/services/search.js";
import { SessionService } from "../src/services/session.js";
import type { ServiceContext } from "../src/services/context.js";

const cleanup: (() => Promise<unknown>)[] = [];
let writer: Client;
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
  await writer.query(
    `INSERT INTO agent_session (organization_id,id,harness,harness_session_id,user_id,ingest_api_key_id,installation_id,cwd,started_at,title,visibility,parent_session_id,parent_relation,repo_name,branch,model,models_used,tools_used,input_tokens,output_tokens)
    VALUES($1,$2::uuid,'CODEX',$2::text,'owner',$3,$4,'/repo','2026-08-01T00:00:00Z',$5,$6::"Visibility",$7,'SUBAGENT',$8,'main','test-model',ARRAY['test-model'],ARRAY['Read','Bash'],9007199254740993,42)`,
    [
      org,
      id,
      org === "org-a" ? "key-a" : "key-b",
      installationId,
      options.title ?? "Read service fixture",
      options.visibility ?? "PUBLIC",
      options.parent ?? null,
      options.repo ?? "host/team/repo",
    ],
  );
  const batchId = randomUUID();
  await writer.query(
    `INSERT INTO ingest_batch (organization_id,id,session_id,api_key_id,user_id,installation_id,ip,behavior,native_event,record_count,duplicate_count,byte_count,redaction_count,duration_ms,cursor,accepted_count,sent_at) VALUES($1,$2,$3,$4,'owner',$5,'127.0.0.1','sync','Stop',1,0,1,0,1,'0:1',1,now())`,
    [org, batchId, id, org === "org-a" ? "key-a" : "key-b", installationId],
  );
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
  const org = options.org ?? "org-a";
  const raw = randomUUID();
  const kind = options.kind ?? "TEXT";
  await writer.query(
    "INSERT INTO raw_record (organization_id,id,session_id,pos,record_type,payload,ingest_batch_id) VALUES($1,$2,$3,$4,'message',$5::jsonb,$6)",
    [org, raw, sessionId, seq, JSON.stringify({ content }), batchId],
  );
  await writer.query(
    `INSERT INTO message (organization_id,id,session_id,raw_record_id,seq,block_index,role,kind,content,tool_name,tool_input,searchable,search_text,timestamp,input_tokens,output_tokens)
    VALUES($1,$2,$3,$4,$5,0,$6::"MessageRole",$7::"MessageKind",$8,$9,$10::jsonb,$11,$12,$13,9007199254740993,42)`,
    [
      org,
      randomUUID(),
      sessionId,
      raw,
      seq,
      options.role ?? "USER",
      kind,
      content,
      options.tool ?? null,
      options.input === undefined ? null : JSON.stringify(options.input),
      !["THINKING", "META"].includes(kind),
      options.searchText ?? content,
      options.timestamp ?? "2026-08-15T00:00:00Z",
    ],
  );
  await writer.query(
    "UPDATE agent_session SET message_count=message_count+1 WHERE id=$1",
    [sessionId],
  );
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
  const container = await new PostgreSqlContainer(
    "pgvector/pgvector:pg16",
  ).start();
  cleanup.push(() => container.stop());
  const url = (role: string) => {
    const value = new URL(container.getConnectionUri());
    value.username = role;
    value.password = "read-test-password";
    return value.toString();
  };
  await promisify(execFile)(
    "pnpm",
    ["--filter", "@agentcommons/db", "migrate"],
    {
      env: {
        ...process.env,
        DATABASE_MIGRATION_URL: container.getConnectionUri(),
        DATABASE_URL: url("ac_app"),
        DATABASE_READER_USER_URL: url("ac_reader_user"),
        DATABASE_READER_ADMIN_URL: url("ac_reader_admin"),
      },
    },
  );
  writer = new Client({ connectionString: container.getConnectionUri() });
  await writer.connect();
  cleanup.push(() => writer.end());
  const prisma = new PrismaClient({ datasourceUrl: url("ac_app") });
  cleanup.push(() => prisma.$disconnect());
  const readers = new ReaderPools(
    { user: url("ac_reader_user"), admin: url("ac_reader_admin") },
    { max: 2 },
  );
  cleanup.push(() => readers.close());
  const dependencies = {
    prisma,
    readers,
    audit: new AuditService(prisma),
    cursors: new CursorCodec("integration-cursor-secret-with-enough-entropy"),
  };
  search = new SearchService(dependencies);
  sessions = new SessionService(dependencies);
  query = new QueryService(dependencies);
  await writer.query(
    `INSERT INTO "user"(id,name,email,"updatedAt") VALUES('owner','Owner','owner@example.test',now()); INSERT INTO organization(id,name,slug,"createdAt") VALUES('org-a','A','a',now()),('org-b','B','b',now()); INSERT INTO api_key_owner(key_id,organization_id,user_id) VALUES('key-a','org-a','owner'),('key-b','org-b','owner')`,
  );
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
  await writer.query(
    "INSERT INTO session_file(organization_id,session_id,path,ops) VALUES('org-a',$1,'src/auth/limiter.ts',ARRAY['write'])",
    [ids.public],
  );
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

describe("read services on PostgreSQL", () => {
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
      sql: "SELECT seq,rank FROM search_messages('rankingmarker') ORDER BY rank DESC",
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
  it("preserves PostgreSQL microseconds in time filters and pagination", async () => {
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
    await writer.query("UPDATE agent_session SET model=$2 WHERE id=$1", [
      id,
      metadata,
    ]);
    await writer.query(
      "UPDATE message SET model=$2,tool_name=$2,tool_use_id=$2,agent_id=$2 WHERE session_id=$1",
      [id, metadata],
    );
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
    const stored = await writer.query<{ model: string }>(
      "SELECT model FROM message WHERE session_id=$1",
      [id],
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
      sql: "SELECT 9007199254740993::bigint AS large,1.234567890123456789::numeric AS precise, NULL::text AS absent",
    });
    expect(result.result.rows).toEqual([
      ["9007199254740993", "1.234567890123456789", null],
    ]);
    expect(result.result.columns.map((column) => column.type)).toEqual([
      "int8",
      "numeric",
      "text",
    ]);
    const capped = await query.execute(context(), {
      sql: "SELECT * FROM generate_series(1,600)",
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
      sql: `SELECT m.content FROM messages m CROSS JOIN generate_series(1,500) WHERE m.session_id='${ids.long}' AND m.seq=0`,
    });
    expect(Buffer.byteLength(JSON.stringify(body.result))).toBeLessThanOrEqual(
      256 * 1024,
    );
    expect(body.result.capped).toBe(true);
    expect(body.result.row_count).toBeLessThan(500);
    const recursive = await query.execute(context(), {
      sql: "WITH RECURSIVE tree(session_id,parent_session_id) AS (SELECT session_id,parent_session_id FROM sessions WHERE parent_session_id IS NULL UNION ALL SELECT s.session_id,s.parent_session_id FROM sessions s JOIN tree t ON s.parent_session_id=t.session_id) SELECT count(*) FROM tree",
    });
    expect(Number(recursive.result.rows[0]?.[0])).toBeGreaterThan(3);
    await expect(
      query.execute(context(), {
        sql: "WITH x AS(DELETE FROM sessions RETURNING *) SELECT * FROM x",
      }),
    ).rejects.toMatchObject({ code: "SQL_NOT_ALLOWED", audited: true });
    await expect(
      query.execute(context(), {
        sql: "SELECT set_config('agentcommons.organization_id','org-b',true)",
      }),
    ).rejects.toMatchObject({ code: "SQL_NOT_ALLOWED" });
    const sqlError: unknown = await query
      .execute(context(), { sql: "SELECT missing_column FROM sessions" })
      .catch((error: unknown) => error);
    const failure = z
      .object({
        code: z.string(),
        detail: z.object({ position: z.number() }),
        message: z.string(),
      })
      .parse(sqlError);
    expect(failure.code).toBe("42703");
    expect(failure.detail.position).toBe(8);
    expect(failure.message).toContain("schema_columns");
    const prefixedSql = "/* lead */ SELECT '🙂',missing_column FROM sessions";
    const prefixed: unknown = await query
      .execute(context(), { sql: prefixedSql })
      .catch((error: unknown) => error);
    expect(
      z.object({ detail: z.object({ position: z.number() }) }).parse(prefixed)
        .detail.position,
    ).toBe(
      Array.from(prefixedSql.slice(0, prefixedSql.indexOf("missing_column")))
        .length + 1,
    );
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
    await writer.query(
      "UPDATE agent_session SET tools_used=$2::text[],models_used=$2::text[] WHERE id=$1",
      [
        parent,
        Array.from(
          { length: 100 },
          (_, index) => `${String(index)}${"🙂".repeat(1000)}`,
        ),
      ],
    );
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
    await writer.query(
      "UPDATE raw_record SET payload=jsonb_build_object('content','redacted changed payload') WHERE session_id=$1 AND pos=0",
      [ids.long],
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
    ).toBeLessThan(150);
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
