import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { ClickHouseError, createTraceClient } from "@agentcommons/traces";
import type { TraceReaders } from "@agentcommons/traces";
import { formatSearch } from "@agentcommons/core/format";
import { afterAll, beforeAll, expect, it } from "vitest";
import { startTraceDatabase } from "../../../packages/traces/test/support.js";
import { TraceFixtures } from "../../../packages/traces/test/fixtures.js";
import {
  emptyTraceRow,
  validateTraceRow,
} from "../../../packages/traces/src/rows.js";
import { CursorCodec } from "../src/services/cursor.js";
import { requireCaller, type ServiceContext } from "../src/services/context.js";
import { SearchService } from "../src/services/search.js";
import { provisionMember, provisionOrganization, releaser } from "./support.js";

/**
 * The production search shape that timed out on 2026-09-11 (ADR 0074): a multi-word query
 * with a repository filter over a corpus of at least 40,000 messages whose search text is
 * about 500 bytes each, so the inflection normalizer has real work per row. The fixture is
 * 400 sessions across nine repositories, 100 messages each, ~80 tokens per message.
 */
const SESSIONS = 400;
const MESSAGES_PER_SESSION = 100;
const QUERY = "judge verbalization attempt classify launch";
/** Two markers that share a session but never a message, for the relaxation fallback. */
const SPLIT_A = "splitalphamarker";
const SPLIT_B = "splitbetamarker";
const VOCAB = [
  "the",
  "of",
  "and",
  "to",
  "in",
  "is",
  "for",
  "with",
  "on",
  "that",
  "this",
  "from",
  "function",
  "tests",
  "running",
  "deployed",
  "policies",
  "libraries",
  "caching",
  "committed",
  "session",
  "message",
  "token",
  "batch",
  "pending",
  "upload",
  "hook",
  "transcript",
  "query",
  "search",
  "result",
  "cursor",
  "limit",
  "context",
  "filter",
  "repository",
  "branch",
  "error",
  "timeout",
  "retry",
  "budget",
  "memory",
  "threads",
  "policy",
  "fence",
  "publication",
  "server",
  "client",
  "request",
  "response",
  "header",
  "body",
  "schema",
  "route",
  "tool",
  "verified",
  "captured",
  "measured",
  "recorded",
  "rendered",
  "parsed",
  "validated",
  "classes",
  "classified",
  "launches",
  "launched",
  "attempts",
  "attempted",
  "judges",
  "judged",
  "ordering",
  "ranking",
  "weighting",
  "matching",
  "scanning",
  "reading",
  "writing",
  "pruning",
  "typescript",
  "clickhouse",
  "postgres",
  "prisma",
  "fastify",
  "vitest",
  "zod",
  "pulumi",
];
let seed = 12345;
const rand = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
const sentence = (words: number) =>
  Array.from(
    { length: words },
    () => VOCAB[Math.floor(rand() * VOCAB.length)] ?? "the",
  ).join(" ");

const { defer, release } = releaser();
let db: Awaited<ReturnType<typeof startTraceDatabase>>;
let fixtures: TraceFixtures;
let admin: ServiceContext;
let member: ServiceContext;
let search: SearchService;
let splitSessionId: string;
/** The next read fails with the given error before any query; null passes through. */
let failNext: Error[] = [];
let failingSearch: SearchService;
const timeLimit = () =>
  new ClickHouseError({
    code: "159",
    type: "TIMEOUT_EXCEEDED",
    message: "Timeout exceeded: elapsed 5.01 s (query: SELECT secret)",
  });
const timed = async <T>(run: () => Promise<T>) => {
  const started = performance.now();
  const value = await run();
  return { value, ms: Math.round(performance.now() - started) };
};

beforeAll(async () => {
  db = await startTraceDatabase();
  defer(() => db.close());
  fixtures = new TraceFixtures(db);
  defer(() => fixtures.close());
  const organization = await provisionOrganization(db, "search-shape");
  const reader = await provisionMember(
    db,
    organization.owner,
    "reader@example.com",
  );
  admin = organization.context;
  member = reader.context;
  const owner = requireCaller(admin);
  const installations = Array.from({ length: 10 }, () => randomUUID());
  const sessions: string[] = [];
  for (let index = 0; index < SESSIONS; index += 1) {
    const { id } = await fixtures.sessionFor(admin, {
      installationId:
        installations[index % installations.length] ?? randomUUID(),
      visibility: index % 10 === 0 ? "PRIVATE" : "PUBLIC",
      fields: {
        title: `Session ${String(index)} on repo-${String(index % 9)}`,
        repo_name: `github.com/acme/repo-${String(index % 9)}`,
        branch: index % 3 ? "main" : "feature",
        message_count: MESSAGES_PER_SESSION,
        started_at: new Date(Date.UTC(2026, 7, 1 + (index % 28), index % 24)),
        last_activity_at: new Date(
          Date.UTC(2026, 7, 1 + (index % 28), index % 24, 30),
        ),
      },
    });
    sessions.push(id);
  }
  // One session whose two query words never share a message (R-SRCH-18): the strict AND
  // matcher finds nothing, the session-level fallback finds the session.
  const split = await fixtures.sessionFor(admin, {
    installationId: installations[0] ?? randomUUID(),
    visibility: "PUBLIC",
    fields: {
      title: "Split recall session on repo-split",
      repo_name: "github.com/acme/repo-split",
      branch: "main",
      message_count: 2,
      started_at: new Date(Date.UTC(2026, 7, 20, 9)),
      last_activity_at: new Date(Date.UTC(2026, 7, 20, 9, 30)),
    },
  });
  splitSessionId = split.id;
  const writer = createTraceClient({
    url: db.traceConfig.url,
    database: db.traceConfig.database,
    username: db.traceConfig.username,
    password: db.traceConfig.password,
  });
  let batch: Record<string, unknown>[] = [];
  const flush = async () => {
    if (batch.length)
      await writer.insert({
        table: "messages",
        values: batch,
        format: "JSONEachRow",
      });
    batch = [];
  };
  for (const [index, id] of sessions.entries()) {
    for (let seq = 0; seq < MESSAGES_PER_SESSION; seq += 1) {
      const kind =
        seq % 5 === 3 ? "TOOL_USE" : seq % 5 === 4 ? "TOOL_RESULT" : "TEXT";
      // Every 50th message of repo-3 carries all five query words.
      const text =
        index % 9 === 3 && seq % 50 === 7
          ? `${sentence(30)} the judge made an attempt to classify the launch verbalization ${sentence(40)}`
          : sentence(80);
      const at = new Date(
        Date.UTC(2026, 7, 1 + (index % 28), index % 24, 0, seq % 60),
      );
      batch.push(
        validateTraceRow("messages", {
          ...emptyTraceRow("messages"),
          message_id: randomUUID(),
          organization_id: owner.organizationId,
          session_id: id,
          seq,
          block_index: 0,
          role:
            kind === "TOOL_RESULT"
              ? "TOOL_RESULT"
              : seq % 2
                ? "ASSISTANT"
                : "USER",
          kind,
          tool_name: kind === "TEXT" ? null : "Bash",
          tool_use_id: kind === "TEXT" ? null : `toolu_${String(seq)}`,
          content: text,
          tool_input: kind === "TOOL_USE" ? '{"command":"ls"}' : "null",
          search_text: text,
          searchable: true,
          timestamp: at,
          received_at: at,
          revision: "1",
          generation: "0",
          deleted: 0,
          fingerprint: "a".repeat(64),
        }),
      );
    }
    if (batch.length >= 5000) await flush();
  }
  await flush();
  // The split session's two messages: one marker each, so no message carries both.
  for (const [seq, marker] of [SPLIT_A, SPLIT_B].entries()) {
    const at = new Date(Date.UTC(2026, 7, 20, 9, seq));
    const text = `${sentence(20)} ${marker} ${sentence(20)}`;
    batch.push(
      validateTraceRow("messages", {
        ...emptyTraceRow("messages"),
        message_id: randomUUID(),
        organization_id: owner.organizationId,
        session_id: splitSessionId,
        seq,
        block_index: 0,
        role: seq % 2 ? "ASSISTANT" : "USER",
        kind: "TEXT",
        tool_name: null,
        tool_use_id: null,
        content: text,
        tool_input: "null",
        search_text: text,
        searchable: true,
        timestamp: at,
        received_at: at,
        revision: "1",
        generation: "0",
        deleted: 0,
        fingerprint: "a".repeat(64),
      }),
    );
  }
  await flush();
  await writer.close();
  const dependencies = {
    prisma: db.prisma,
    readers: db.traceReaders,
    audit: db.audit,
    cursors: new CursorCodec("search-shape-cursor-secret-with-entropy"),
  };
  search = new SearchService(dependencies);
  const failing = new Proxy(db.traceReaders, {
    get(target, property, receiver): unknown {
      if (property !== "read") return Reflect.get(target, property, receiver);
      const read: TraceReaders["read"] = (caller, operation) => {
        const error = failNext.shift();
        if (error) return Promise.reject(error);
        return target.read(caller, operation);
      };
      return read;
    },
  });
  failingSearch = new SearchService({ ...dependencies, readers: failing });
}, 300_000);
afterAll(release);

// @req R-SRCH-06 @req R-SRCH-02
it("completes the incident search shape well under the reader time limit as admin and member, alone and four at a time", async () => {
  const input = {
    query: QUERY,
    filters: { repo_name: "repo-3" },
    limit: 6,
    context: 1,
  };
  for (const [who, context] of [
    ["admin", admin],
    ["member", member],
  ] as const) {
    const single = await timed(() => search.execute(context, input));
    expect(single.value.result.blocks.length, who).toBe(6);
    expect(single.value.result.total.hits, who).toBeGreaterThan(50);
    expect(single.value.result.partial, who).toBeNull();
    // 5 s is the reader limit; the fixed shape runs in well under a second locally.
    expect(single.ms, `${who} single search ms`).toBeLessThan(2500);
    const started = performance.now();
    const concurrent = await Promise.all(
      Array.from({ length: 4 }, () => search.execute(context, input)),
    );
    const wall = performance.now() - started;
    for (const page of concurrent)
      expect(page.result.total, who).toEqual(single.value.result.total);
    expect(wall, `${who} four concurrent searches wall ms`).toBeLessThan(4000);
    // The unfiltered multi-word search scans the whole organization and stays cheap too.
    const unfiltered = await timed(() =>
      search.execute(context, { query: "deployed policies", limit: 6 }),
    );
    expect(unfiltered.value.result.blocks.length, who).toBe(6);
    expect(unfiltered.ms, `${who} unfiltered search ms`).toBeLessThan(2500);
  }
});

// @req R-SRCH-16 @req R-GET-07
it("answers a timed-out first page with one bounded attempt over the most recent matching sessions, marked partial, and keeps READ_TIME_LIMIT for cursors and a second failure", async () => {
  failNext = [timeLimit()];
  const partial = await failingSearch.execute(admin, {
    query: QUERY,
    filters: { repo_name: "repo-3" },
    limit: 6,
    context: 1,
  });
  expect(failNext).toEqual([]);
  expect(partial.result.partial).toEqual({
    sessions_searched: expect.any(Number) as number,
  });
  const searched = partial.result.partial?.sessions_searched ?? 0;
  expect(searched).toBeGreaterThan(0);
  expect(searched).toBeLessThanOrEqual(50);
  expect(partial.result.blocks.length).toBeGreaterThan(0);
  // context 0 on the bounded page: every message shown is a hit.
  for (const block of partial.result.blocks)
    for (const message of block.messages) expect(message.hit).toBe(true);
  expect(partial.result.cursor).toBeNull();
  const text = formatSearch(partial.result).text.split("\n\n");
  expect(text[1]).toContain(
    `Partial result: the full search exceeded the read time limit, so this page covers the ${String(searched)} most recently active sessions`,
  );
  // The bounded set is the most recently active matching sessions, so its totals are a
  // subset of the complete search's.
  const complete = await search.execute(admin, {
    query: QUERY,
    filters: { repo_name: "repo-3" },
    limit: 6,
    context: 0,
  });
  expect(partial.result.total.sessions).toBeLessThanOrEqual(
    complete.result.total.sessions,
  );
  expect(partial.result.total.hits).toBeLessThanOrEqual(
    complete.result.total.hits,
  );
  // A continuation page is not degraded: the agent already holds a complete first page.
  const first = await search.execute(admin, { query: QUERY, limit: 2 });
  expect(first.result.cursor).not.toBeNull();
  failNext = [timeLimit()];
  await expect(
    failingSearch.execute(admin, {
      query: QUERY,
      limit: 2,
      cursor: first.result.cursor,
    }),
  ).rejects.toMatchObject({ statusCode: 503, code: "READ_TIME_LIMIT" });
  // A bounded attempt that also times out is the documented failure.
  failNext = [timeLimit(), timeLimit()];
  await expect(
    failingSearch.execute(admin, { query: QUERY, limit: 2 }),
  ).rejects.toMatchObject({ statusCode: 503, code: "READ_TIME_LIMIT" });
  expect(failNext).toEqual([]);
});

// @req R-SRCH-18
it("relaxes to session-level matching when the strict token match finds nothing, within the reader limit", async () => {
  // A single marker is in one message, so the strict matcher finds it.
  const single = await search.execute(admin, { query: SPLIT_A, limit: 6 });
  expect(single.result.total.hits).toBeGreaterThan(0);
  // Both markers share the split session but never a message, so the strict AND matcher is
  // empty and the service relaxes to the session-level matcher, which returns the session.
  // The fallback scans more than the strict path, so it is measured as admin and member,
  // alone and four at a time, against the reader limit like the incident shape.
  const relaxedInput = { query: `${SPLIT_A} ${SPLIT_B}`, limit: 6 };
  for (const [who, context] of [
    ["admin", admin],
    ["member", member],
  ] as const) {
    const relaxed = await timed(() => search.execute(context, relaxedInput));
    expect(relaxed.value.result.total.sessions, who).toBe(1);
    expect(
      relaxed.value.result.blocks.map((block) => block.session_id),
      who,
    ).toContain(splitSessionId);
    expect(relaxed.value.result.partial, who).toBeNull();
    expect(relaxed.ms, `${who} relaxed search ms`).toBeLessThan(2500);
    const started = performance.now();
    await Promise.all(
      Array.from({ length: 4 }, () => search.execute(context, relaxedInput)),
    );
    expect(
      performance.now() - started,
      `${who} four concurrent relaxed searches wall ms`,
    ).toBeLessThan(4000);
  }
  // A page that already has hits does not relax: a strict multi-word query that matches
  // returns its strict result unchanged.
  const strict = await search.execute(admin, {
    query: QUERY,
    filters: { repo_name: "repo-3" },
    limit: 6,
  });
  expect(strict.result.total.hits).toBeGreaterThan(50);
  // A genuine miss stays empty: no session carries a token absent from the whole corpus.
  const miss = await search.execute(admin, {
    query: `${SPLIT_A} nonexistenttokenzzz`,
    limit: 6,
  });
  expect(miss.result.total.hits).toBe(0);
  // A single-token query never relaxes; an absent token stays empty either way.
  const singleMiss = await search.execute(admin, {
    query: "nonexistenttokenzzz",
    limit: 6,
  });
  expect(singleMiss.result.total.hits).toBe(0);
});
