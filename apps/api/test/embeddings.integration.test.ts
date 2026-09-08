import { cleanup as cleanupAll } from "../../../scripts/cleanup.js";
import { setTimeout as delay } from "node:timers/promises";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";
import { createApp } from "../src/app.js";
import { createRuntime } from "../src/main.js";
import { environment } from "../src/env.js";
import { testAuthConfiguration } from "./support.js";
import { ReaderPools } from "@agentcommons/db";
import type { IngestEnvelope } from "@agentcommons/core";
import { startDatabase, provisionOrganization } from "./support.js";
import { EmbeddingService } from "../src/embeddings/service.js";
import { FakeEmbeddingProvider } from "../src/embeddings/provider.js";
import { tokenize } from "../src/embeddings/chunker.js";
import { IngestService } from "../src/services/ingest.js";
import { JobService } from "../src/services/jobs.js";
import { SearchService } from "../src/services/search.js";
import { SimilarService } from "../src/services/similar.js";
import { QueryService } from "../src/services/query.js";
import { CursorCodec } from "../src/services/cursor.js";
import { PolicyService } from "../src/services/policies.js";
import { AdminService } from "../src/services/admin.js";
let db: Awaited<ReturnType<typeof startDatabase>>;
let first: Awaited<ReturnType<typeof provisionOrganization>>;
let other: Awaited<ReturnType<typeof provisionOrganization>>;
let readers: ReaderPools;
const provider = new FakeEmbeddingProvider();
let embeddings: EmbeddingService;
let ingest: IngestService;
const cursors = new CursorCodec("embedding-test-cursor-key");
function request(text: string): IngestEnvelope {
  return {
    envelopeVersion: 2,
    harness: "CLAUDE_CODE",
    harnessSessionId: uuidv7(),
    behavior: "sync",
    start: null,
    nativeEvent: "Stop",
    batchId: uuidv7(),
    installationId: uuidv7(),
    sentAt: new Date().toISOString(),
    context: {
      cwd: "/repo",
      installation: {
        hostname: "host",
        osUser: "user",
        platform: "linux",
        arch: "x64",
      },
      git: null,
      parentHint: null,
    },
    records: [
      {
        pos: 0,
        sourceVersion: 0,
        key: "0",
        line: JSON.stringify({
          type: "user",
          message: { content: [{ type: "text", text }] },
        }),
      },
    ],
    sourcePos: 1,
    cursor: "1",
    end: null,
  };
}
async function corpus(text: string, account = first) {
  const envelope = request(text);
  const result = await ingest.execute(account.context, envelope);
  return {
    organizationId: account.context.caller?.organizationId ?? "",
    sessionId: result.result.sessionId,
    envelope,
  };
}
async function index(
  data: { organizationId: string; sessionId: string },
  service = embeddings,
) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const result = await service.process(data);
    if (result.complete) return;
    if (result.deferredUntil) throw new Error("Unexpected indexing deferral");
  }
  throw new Error("Index did not finish");
}
const release: Array<() => Promise<unknown>> = [];
beforeAll(async () => {
  db = await startDatabase();
  release.unshift(() => db.close());
  first = await provisionOrganization(db, "embedding-first");
  other = await provisionOrganization(db, "embedding-other");
  readers = new ReaderPools(db.urls, {}, { embeddings: true });
  release.unshift(() => readers.close());
  embeddings = new EmbeddingService({
    ...db,
    provider,
    dailyTokenBudget: 5_000_000,
  });
  await embeddings.initialize();
  ingest = new IngestService(db);
});
afterAll(async () => {
  expect(await cleanupAll(release.splice(0))).toEqual([]);
});

describe("durable organization embedding index", () => {
  it("reserves concurrent query attempts atomically and keeps failed/uncertain reservations charged @req R-EMB-02 @req R-ORG-09", async () => {
    const account = await provisionOrganization(db, "embedding-budget");
    const org = account.context.caller?.organizationId ?? "";
    const limited = new EmbeddingService({
      ...db,
      provider,
      dailyTokenBudget: 10,
    });
    const reservations = await Promise.all(
      Array.from({ length: 8 }, () =>
        db.prisma.$transaction((tx) =>
          limited.budget.reserve(tx, org, "query", [
            tokenize("one two three four"),
          ]),
        ),
      ),
    );
    const accepted = reservations.flatMap((result) =>
      result.reservation ? [result.reservation] : [],
    );
    expect(accepted).toHaveLength(2);
    expect(accepted.reduce((sum, row) => sum + row.reservedTokens, 0)).toBe(8);
    const reservation = accepted[0];
    if (!reservation) throw new Error("Missing reservation");
    await db.prisma.$transaction((tx) =>
      limited.budget.finish(tx, reservation.id, null),
    );
    expect((await limited.budget.status(org)).embedding_daily_tokens).toBe("8");
    expect(
      (await limited.budget.status(other.context.caller?.organizationId ?? ""))
        .embedding_daily_tokens,
    ).toBe("0");
    const deferred = await db.prisma.$transaction((tx) =>
      limited.budget.reserve(tx, org, "index", [tokenize("one two three")]),
    );
    expect(deferred.reservation).toBeNull();
    expect(deferred.deferredUntil?.getUTCHours()).toBe(0);
  });
  it("indexes all chunks and one summary vector, fuses semantic hits, and enforces both reader roles across organizations @req R-EMB-02 @req R-EMB-03 @req R-EMB-04 @req R-ORG-09", async () => {
    const source = await corpus("oranges citrus orchard");
    const near = await corpus("oranges citrus orchard harvesting");
    const privateRow = await corpus("oranges citrus secret private orchard");
    const foreign = await corpus("oranges citrus orchard", other);
    await db.prisma.agentSession.update({
      where: { id: privateRow.sessionId },
      data: { visibility: "PRIVATE" },
    });
    await Promise.all(
      [source, near, privateRow, foreign].map((data) => index(data)),
    );
    const rows = await db.prisma.$queryRaw<
      { count: bigint; valid: boolean }[]
    >`SELECT count(*),bool_and(vector_dims(embedding)=1024) valid FROM message_chunk WHERE session_id=${source.sessionId}::uuid`;
    expect(rows[0]).toEqual({ count: 1n, valid: true });
    expect(
      await db.prisma.sessionEmbedding.count({
        where: { sessionId: source.sessionId },
      }),
    ).toBe(1);
    const dependencies = { ...db, readers, cursors };
    if (!first.context.caller) throw new Error("Missing caller");
    await readers.read(first.context.caller, (client) =>
      client.query("SELECT * FROM api_ro.similar_sessions($1::uuid,50)", [
        source.sessionId,
      ]),
    );
    const similar = await new SimilarService(dependencies).execute(
      first.context,
      source.sessionId,
      { max_rows: 50 },
    );
    expect(similar.result.sessions.map((row) => row.session_id)).toContain(
      near.sessionId,
    );
    expect(similar.result.sessions.map((row) => row.session_id)).toContain(
      privateRow.sessionId,
    );
    expect(similar.result.sessions.map((row) => row.session_id)).not.toContain(
      foreign.sessionId,
    );
    const user = {
      ...first.context,
      caller: {
        ...first.context.caller,
        role: "member" as const,
        permissions: { sessions: ["read" as const] },
      },
    };
    const visible = await new SimilarService(dependencies).execute(
      user,
      source.sessionId,
      {},
    );
    expect(visible.result.sessions.map((row) => row.session_id)).not.toContain(
      privateRow.sessionId,
    );
    await expect(
      new SimilarService(dependencies).execute(user, privateRow.sessionId, {}),
    ).rejects.toMatchObject({ statusCode: 404 });
    const query = new QueryService(dependencies, true);
    const sql = await query.execute(first.context, {
      sql: `SELECT * FROM similar_sessions('${source.sessionId}',50)`,
    });
    expect(JSON.stringify(sql.result)).not.toContain(foreign.sessionId);
    const queryVector = (await provider.embed([tokenize("orchard")]))
      .vectors[0];
    if (!queryVector) throw new Error("Missing query vector");
    const ranking = await readers.read(first.context.caller, async (client) => {
      const lexical = await client.query<{ session_id: string }>(
        "SELECT session_id FROM api_ro.messages WHERE searchable AND search_tsv @@ websearch_to_tsquery('english','orchard') ORDER BY ts_rank_cd(search_tsv,websearch_to_tsquery('english','orchard') || websearch_to_tsquery('simple','orchard'),33) DESC,session_id,seq",
      );
      const semantic = await client.query<{ session_id: string }>(
        "SELECT c.session_id FROM api_vector.message_chunks c ORDER BY api_vector.cosine(c.embedding,api_vector.input($1)),c.message_id",
        [`[${queryVector.join(",")}]`],
      );
      const scores = new Map<string, number>();
      for (const rows of [lexical.rows, semantic.rows])
        rows.forEach((row, index) =>
          scores.set(
            row.session_id,
            (scores.get(row.session_id) ?? 0) + 1 / (61 + index),
          ),
        );
      return [...scores]
        .sort(
          ([leftId, left], [rightId, right]) =>
            right - left || leftId.localeCompare(rightId),
        )
        .map(([id]) => id);
    });
    const search = new SearchService(
      dependencies,
      { context: 0, limit: 50 },
      embeddings,
    );
    const result = await search.execute(first.context, {
      query: "orchard",
      context: 0,
      limit: 50,
    });
    expect(result.result.blocks.map((block) => block.session_id)).toContain(
      source.sessionId,
    );
    expect(result.result.blocks.map((block) => block.session_id)).toEqual(
      ranking,
    );
    expect(result.result.blocks.map((block) => block.session_id)).not.toContain(
      foreign.sessionId,
    );
    const semantic = await search.execute(first.context, {
      query: "absentlexicalterm",
      context: 0,
      limit: 50,
    });
    expect(semantic.result.blocks.length).toBeGreaterThan(0);
    expect(
      (
        await new SearchService(dependencies).execute(first.context, {
          query: "absentlexicalterm",
        })
      ).result.blocks,
    ).toHaveLength(0);
  });
  it("discards in-flight vectors after purge and rebuilds after changed projection @req R-EMB-04", async () => {
    const item = await corpus("initial searchable content");
    await index(item);
    await ingest.execute(first.context, {
      ...item.envelope,
      batchId: uuidv7(),
      records: [
        {
          pos: 1,
          sourceVersion: 0,
          key: "1",
          line: JSON.stringify({
            type: "assistant",
            message: { content: [{ type: "text", text: "new reply content" }] },
          }),
        },
      ],
      sourcePos: 2,
      cursor: "2",
    });
    expect(
      await db.prisma.sessionEmbedding.count({
        where: { sessionId: item.sessionId },
      }),
    ).toBe(0);
    const pending = await corpus("remove me while provider is busy");
    let started: () => void = () => {};
    const began = new Promise<void>((resolve) => {
      started = resolve;
    });
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow = new FakeEmbeddingProvider();
    const native = slow.embed.bind(slow);
    vi.spyOn(slow, "embed").mockImplementation(async (inputs) => {
      started();
      await gate;
      return native(inputs);
    });
    const service = new EmbeddingService({
      ...db,
      provider: slow,
      dailyTokenBudget: 5_000_000,
    });
    const work = service.process(pending);
    await began;
    const jobs = new JobService({
      ...db,
      connectionString: db.urls.app,
      allowedEmailDomains: [],
      auditRetentionDays: 30,
      onError: () => {},
    });
    const admin = new AdminService({ ...db, cursors, jobs });
    await admin.purge(first.context, {
      session_id: pending.sessionId,
      reason: "Remove test session",
    });
    release();
    await work;
    expect(
      await db.prisma.sessionEmbedding.count({
        where: { sessionId: pending.sessionId },
      }),
    ).toBe(0);
    expect(
      await db.prisma.messageChunk.count({
        where: { sessionId: pending.sessionId },
      }),
    ).toBe(0);
    await index(item);
    expect(
      await db.prisma.messageChunk.count({
        where: { sessionId: item.sessionId },
      }),
    ).toBe(2);
  });
  it("native pg-boss catches up retained sessions when enabled and never indexes when disabled @req R-EMB-01 @req R-EMB-05", async () => {
    const retained = await corpus("retained corpus catchup");
    const off = new JobService({
      ...db,
      connectionString: db.urls.app,
      allowedEmailDomains: [],
      auditRetentionDays: 30,
      onError: () => {},
    });
    await off.start();
    await delay(1200);
    await off.stop();
    expect(
      await db.prisma.messageChunk.count({
        where: { sessionId: retained.sessionId },
      }),
    ).toBe(0);
    const hidden = await db.readers.read(
      first.context.caller ??
        (() => {
          throw new Error("Missing caller");
        })(),
      (client) =>
        client.query<{ function_name: string }>(
          "SELECT function_name FROM api_ro.schema_functions",
        ),
    );
    expect(hidden.rows.map((row) => row.function_name)).not.toContain(
      "similar_sessions",
    );
    await expect(
      new QueryService({ ...db, cursors }).execute(first.context, {
        sql: `SELECT * FROM similar_sessions('${retained.sessionId}',5)`,
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    const on = new JobService({
      ...db,
      embeddings,
      connectionString: db.urls.app,
      allowedEmailDomains: [],
      auditRetentionDays: 30,
      onError: () => {},
    });
    try {
      await on.start();
      const deadline = Date.now() + 20_000;
      while (
        !(
          await db.prisma.embeddingState.findUnique({
            where: {
              organizationId_sessionId: {
                organizationId: retained.organizationId,
                sessionId: retained.sessionId,
              },
            },
          })
        )?.complete
      ) {
        if (Date.now() > deadline) throw new Error("Native catchup timed out");
        await delay(100);
      }
      expect(
        (await on.status(retained.organizationId)).embedding_daily_tokens,
      ).not.toBe("0");
    } finally {
      await on.stop();
    }
  });
  it("keeps exact matches beyond a noisy session's 500 messages and applies the three-hit cap @req R-EMB-03", async () => {
    const account = await provisionOrganization(db, "embedding-noisy");
    const envelope = request("placeholder");
    envelope.records = [
      {
        pos: 0,
        sourceVersion: 0,
        key: "0",
        line: JSON.stringify({
          type: "user",
          message: {
            content: Array.from({ length: 501 }, () => ({
              type: "text",
              text: "noisykeyword noisykeyword noisykeyword",
            })),
          },
        }),
      },
    ];
    const noisy = await ingest.execute(account.context, envelope);
    const quiet = await corpus(
      `noisykeyword ${"padding ".repeat(40)}`,
      account,
    );
    const service = new SearchService(
      { ...db, readers, cursors },
      { context: 0, limit: 50 },
      embeddings,
    );
    const result = (
      await service.execute(account.context, {
        query: "noisykeyword",
        context: 0,
        limit: 50,
      })
    ).result;
    expect(
      result.blocks.flatMap((block) =>
        block.messages
          .filter((message) => message.hit)
          .map(() => block.session_id),
      ),
    ).toContain(quiet.sessionId);
    expect(
      result.blocks
        .filter((block) => block.session_id === noisy.result.sessionId)
        .flatMap((block) => block.messages.filter((message) => message.hit)),
    ).toHaveLength(3);
  });
  it("validates cursors before billing and keeps their ranking basis through provider failures @req R-EMB-03", async () => {
    const account = await provisionOrganization(db, "embedding-cursor");
    const one = await corpus("cursor orchard one", account);
    const two = await corpus("cursor orchard two", account);
    await index(one);
    await index(two);
    const tracked = new FakeEmbeddingProvider();
    const calls = vi.spyOn(tracked, "embed");
    const service = new EmbeddingService({
      ...db,
      provider: tracked,
      dailyTokenBudget: 5_000_000,
    });
    const search = new SearchService(
      { ...db, readers, cursors },
      { context: 0, limit: 1 },
      service,
    );
    await expect(
      search.execute(account.context, {
        query: "orchard",
        context: 0,
        limit: 1,
        cursor: "invalid-signed-cursor",
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(calls).not.toHaveBeenCalled();
    const firstPage = (
      await search.execute(account.context, {
        query: "orchard",
        context: 0,
        limit: 1,
      })
    ).result;
    expect(firstPage.cursor).toBeTruthy();
    calls.mockRejectedValueOnce(new Error("temporary provider failure"));
    await expect(
      search.execute(account.context, {
        query: "orchard",
        context: 0,
        limit: 1,
        cursor: firstPage.cursor,
      }),
    ).rejects.toMatchObject({
      statusCode: 503,
      code: "SEARCH_RANKING_UNAVAILABLE",
    });
    const nextPage = (
      await search.execute(account.context, {
        query: "orchard",
        context: 0,
        limit: 1,
        cursor: firstPage.cursor,
      })
    ).result;
    expect(nextPage.blocks[0]?.session_id).not.toBe(
      firstPage.blocks[0]?.session_id,
    );
    calls.mockRejectedValueOnce(new Error("first page provider failure"));
    const lexical = (
      await search.execute(account.context, {
        query: "orchard",
        context: 0,
        limit: 1,
      })
    ).result;
    const before = calls.mock.calls.length;
    await search.execute(account.context, {
      query: "orchard",
      context: 0,
      limit: 1,
      cursor: lexical.cursor,
    });
    expect(calls.mock.calls.length).toBe(before);
  });
  it("applies current policies before persisting chunks or dispatching stored historical text @req R-EMB-02 @req R-RED-02", async () => {
    const account = await provisionOrganization(db, "embedding-policy");
    const item = await corpus("newlyclassified ordinary corpus", account);
    const policies = new PolicyService({ ...db, cursors, cache: db.policies });
    await policies.save(account.owner, null, {
      name: "index-current-policy",
      kind: "REGEX",
      pattern: "newlyclassified",
      flags: "g",
      enabled: true,
    });
    const tracked = new FakeEmbeddingProvider();
    const calls = vi.spyOn(tracked, "embed");
    const service = new EmbeddingService({
      ...db,
      provider: tracked,
      dailyTokenBudget: 5_000_000,
    });
    await index(item, service);
    expect(
      calls.mock.calls
        .flatMap((call) => call[0])
        .every((input) => !input.content.includes("newlyclassified")),
    ).toBe(true);
    expect(
      (
        await db.prisma.messageChunk.findMany({
          where: { sessionId: item.sessionId },
        })
      ).every((row) => !row.content.includes("newlyclassified")),
    ).toBe(true);
    expect(
      (
        await db.prisma.message.findMany({
          where: { sessionId: item.sessionId },
        })
      ).some((row) => row.searchText.includes("newlyclassified")),
    ).toBe(true);
  });
  it("rolls back reservations and placeholders before dispatch when its prepare audit fails @req R-EMB-02 @req R-AUD-01", async () => {
    const account = await provisionOrganization(db, "embedding-prepare-audit");
    const item = await corpus("prepare audit corpus", account);
    const tracked = new FakeEmbeddingProvider();
    const calls = vi.spyOn(tracked, "embed");
    const service = new EmbeddingService({
      ...db,
      provider: tracked,
      dailyTokenBudget: 5_000_000,
    });
    const write = db.audit.write.bind(db.audit);
    vi.spyOn(db.audit, "write").mockImplementation(
      async (context, description, tx) => {
        if (description.action === "embeddings.reserve")
          throw new Error("Injected prepare audit failure");
        return write(context, description, tx);
      },
    );
    await expect(service.process(item)).rejects.toThrow(
      "Injected prepare audit failure",
    );
    expect(calls).not.toHaveBeenCalled();
    expect(
      await db.prisma.embeddingAttempt.count({
        where: { organizationId: item.organizationId },
      }),
    ).toBe(0);
    expect(
      await db.prisma.embeddingBudget.count({
        where: { organizationId: item.organizationId },
      }),
    ).toBe(0);
    expect(
      await db.prisma.messageChunk.count({
        where: { sessionId: item.sessionId },
      }),
    ).toBe(0);
    expect(
      await db.prisma.sessionEmbedding.count({
        where: { sessionId: item.sessionId },
      }),
    ).toBe(0);
    expect(
      await db.prisma.embeddingState.count({
        where: { sessionId: item.sessionId },
      }),
    ).toBe(0);
  });
  it("charges uncertain committed HTTP attempts across checkpoint rollback and retries @req R-EMB-02", async () => {
    const account = await provisionOrganization(db, "embedding-retry");
    const item = await corpus("retry checkpoint corpus", account);
    const tracked = new FakeEmbeddingProvider();
    const calls = vi.spyOn(tracked, "embed");
    const service = new EmbeddingService({
      ...db,
      provider: tracked,
      dailyTokenBudget: 5_000_000,
    });
    const write = db.audit.write.bind(db.audit);
    let failAudit = true;
    vi.spyOn(db.audit, "write").mockImplementation(
      async (context, description, tx) => {
        if (description.action === "embeddings.index" && failAudit) {
          failAudit = false;
          throw new Error("Injected atomic vector audit failure");
        }
        return write(context, description, tx);
      },
    );
    await expect(service.process(item)).rejects.toThrow(
      "Injected atomic vector audit failure",
    );
    const reserved = await db.prisma.embeddingAttempt.findMany({
      where: { organizationId: item.organizationId },
    });
    expect(reserved).toHaveLength(1);
    expect(reserved[0]?.state).toBe("reserved");
    const pending = await db.prisma.$queryRaw<
      { pending: boolean }[]
    >`SELECT embedding IS NULL pending FROM session_embedding WHERE session_id=${item.sessionId}::uuid`;
    expect(pending).toEqual([{ pending: true }]);
    await db.prisma.embeddingState.update({
      where: {
        organizationId_sessionId: {
          organizationId: item.organizationId,
          sessionId: item.sessionId,
        },
      },
      data: { leaseUntil: new Date(0) },
    });
    await index(item, service);
    expect(calls).toHaveBeenCalledTimes(2);
    const attempts = await db.prisma.embeddingAttempt.findMany({
      where: { organizationId: item.organizationId },
      orderBy: { createdAt: "asc" },
    });
    expect(attempts.map((attempt) => attempt.state)).toEqual([
      "reserved",
      "completed",
    ]);
    expect(
      (await service.budget.status(item.organizationId)).embedding_daily_tokens,
    ).toBe(String(2 * (reserved[0]?.reservedTokens ?? 0)));
    expect(
      await db.prisma.auditEvent.count({
        where: {
          organizationId: item.organizationId,
          action: "embeddings.index",
        },
      }),
    ).toBe(1);
  });
  it("rescan replaces vectors from the redacted projection through the native queue @req R-EMB-04 @req R-ORG-09", async () => {
    const account = await provisionOrganization(db, "embedding-rescan");
    const item = await corpus("classifiedphrase ordinary text", account);
    await index(item);
    const policies = new PolicyService({ ...db, cursors, cache: db.policies });
    await policies.save(account.owner, null, {
      name: "rescan-embedding-phrase",
      kind: "REGEX",
      pattern: "classifiedphrase",
      flags: "g",
      enabled: true,
    });
    const jobs = new JobService({
      ...db,
      embeddings,
      connectionString: db.urls.app,
      allowedEmailDomains: [],
      auditRetentionDays: 30,
      onError: () => {},
    });
    try {
      await jobs.start();
      const admin = new AdminService({ ...db, cursors, jobs });
      const run = await admin.rescan(account.owner, {
        reason: "Redact derived embeddings",
      });
      const deadline = Date.now() + 20_000;
      for (;;) {
        const progress = (await jobs.progress(account.owner, run.result.job_id))
          .result;
        const state = await db.prisma.embeddingState.findUnique({
          where: {
            organizationId_sessionId: {
              organizationId: item.organizationId,
              sessionId: item.sessionId,
            },
          },
        });
        const rows = await db.prisma.messageChunk.findMany({
          where: { sessionId: item.sessionId },
        });
        if (
          progress.state === "completed" &&
          state?.complete &&
          rows.length &&
          rows.every((row) => !row.content.includes("classifiedphrase"))
        )
          break;
        if (Date.now() > deadline)
          throw new Error("Native rescan did not reindex");
        await delay(100);
      }
    } finally {
      await jobs.stop();
    }
  });
  it("persists native next-day deferral without accumulating maintenance duplicates @req R-EMB-02", async () => {
    const account = await provisionOrganization(db, "embedding-deferral");
    const item = await corpus("daily budget deferred corpus", account);
    const limited = new EmbeddingService({
      ...db,
      provider,
      dailyTokenBudget: 1,
    });
    const jobs = new JobService({
      ...db,
      embeddings: limited,
      connectionString: db.urls.app,
      allowedEmailDomains: [],
      auditRetentionDays: 30,
      onError: () => {},
    });
    try {
      await jobs.start();
      const deadline = Date.now() + 20_000;
      for (;;) {
        const future = await db.prisma.$queryRaw<
          { count: bigint }[]
        >`SELECT count(*) FROM pgboss.job WHERE name='session-embedding' AND data->>'sessionId'=${item.sessionId} AND state='created' AND start_after>now()`;
        if (future[0]?.count) break;
        if (Date.now() > deadline)
          throw new Error("Missing native next-day delivery");
        await delay(100);
      }
      const before = await db.prisma.$queryRaw<
        { count: bigint }[]
      >`SELECT count(*) FROM pgboss.job WHERE name='session-embedding' AND data->>'sessionId'=${item.sessionId} AND state IN ('created','retry','active')`;
      await jobs.maintenance();
      await jobs.maintenance();
      const after = await db.prisma.$queryRaw<
        { count: bigint }[]
      >`SELECT count(*) FROM pgboss.job WHERE name='session-embedding' AND data->>'sessionId'=${item.sessionId} AND state IN ('created','retry','active')`;
      expect(after).toEqual(before);
      expect(
        (await limited.budget.status(item.organizationId))
          .embedding_daily_tokens,
      ).toBe("0");
      expect(
        await db.prisma.auditEvent.count({
          where: {
            organizationId: item.organizationId,
            action: "embeddings.reserve",
          },
        }),
      ).toBeGreaterThan(0);
    } finally {
      await jobs.stop();
    }
  });
  it("measures exact filtered cosine on a 500-message corpus and retains both HNSW indexes", async () => {
    const account = await provisionOrganization(db, "embedding-plan");
    for (let session = 0; session < 20; session++) {
      const envelope = request("placeholder");
      envelope.records = [
        {
          pos: 0,
          sourceVersion: 0,
          key: "0",
          line: JSON.stringify({
            type: "user",
            message: {
              content: Array.from({ length: 25 }, (_, message) => ({
                type: "text",
                text: `orchard citrus experiment ${String(session)} message ${String(message)} harvesting`,
              })),
            },
          }),
        },
      ];
      const accepted = await ingest.execute(account.context, envelope);
      await index({
        organizationId: account.context.caller?.organizationId ?? "",
        sessionId: accepted.result.sessionId,
      });
    }
    if (!account.context.caller) throw new Error("Missing caller");
    const vector = (await provider.embed([tokenize("orchard citrus")]))
      .vectors[0];
    if (!vector) throw new Error("Missing vector");
    const explain = await readers.read(account.context.caller, (client) =>
      client.query<Record<string, unknown>>(
        "EXPLAIN (FORMAT JSON) SELECT message_id,min(api_vector.cosine(embedding,api_vector.input($1))) distance FROM api_vector.message_chunks GROUP BY message_id ORDER BY distance LIMIT 500",
        [`[${vector.join(",")}]`],
      ),
    );
    const plan = z
      .array(z.looseObject({ Plan: z.unknown() }))
      .parse(explain.rows[0]?.["QUERY PLAN"])[0]?.Plan;
    const nodes = new Set<string>();
    const usedIndexes = new Set<string>();
    function inspect(value: unknown) {
      const node = z.record(z.string(), z.unknown()).parse(value);
      if (typeof node["Node Type"] === "string") nodes.add(node["Node Type"]);
      if (typeof node["Index Name"] === "string")
        usedIndexes.add(node["Index Name"]);
      if (Array.isArray(node.Plans))
        for (const child of node.Plans) inspect(child);
    }
    inspect(plan);
    const installed = await db.prisma.$queryRaw<
      { indexname: string }[]
    >`SELECT indexname FROM pg_indexes WHERE indexname IN ('message_chunk_cosine','session_embedding_cosine') AND indexdef LIKE '%USING hnsw%vector_cosine_ops%'`;
    expect(installed).toHaveLength(2);
    expect(nodes.has("Aggregate")).toBe(true);
    const search = new SearchService(
      { ...db, readers, cursors },
      { context: 0, limit: 5 },
      embeddings,
    );
    await search.execute(account.context, {
      query: "orchard citrus",
      context: 0,
      limit: 5,
    });
    const samples = [];
    for (let count = 0; count < 20; count++) {
      const start = performance.now();
      const result = await search.execute(account.context, {
        query: "orchard citrus",
        context: 0,
        limit: 5,
      });
      expect(result.result.blocks.length).toBeGreaterThan(0);
      samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    process.stdout.write(
      `Embedding experiment ${JSON.stringify({ sessions: 20, messages: 500, nodes: [...nodes], used_indexes: [...usedIndexes], warm_p50_ms: samples[10], warm_p95_ms: samples[18] })}\n`,
    );
  });
  it("filters the live REST/Swagger surface and preserves the actual MCP tool schemas across flags @req R-EMB-01 @req R-EMB-03 @req R-EMB-04", async () => {
    const item = await corpus("route similarity source");
    const neighbor = await corpus("route similarity neighbor");
    await index(item);
    await index(neighbor);
    const catalogs: unknown[] = [];
    const dispatches = vi.spyOn(FakeEmbeddingProvider.prototype, "embed");
    for (const enabled of [false, true]) {
      const env = environment({
        PUBLIC_URL: testAuthConfiguration.publicUrl,
        BETTER_AUTH_SECRET: testAuthConfiguration.secret,
        DATABASE_URL: db.urls.app,
        DATABASE_READER_USER_URL: db.urls.user,
        DATABASE_READER_ADMIN_URL: db.urls.admin,
        EMBEDDINGS_ENABLED: String(enabled),
        EMBEDDINGS_PROVIDER: "fake",
        LOG_LEVEL: "silent",
      });
      const runtime = await createRuntime(env);
      const app = await createApp({ env, services: runtime.services });
      const client = new Client({
        name: "embedding-contract-test",
        version: "1",
      });
      try {
        const address = await app.listen({ host: "127.0.0.1", port: 0 });
        const response = await app.inject({
          method: "GET",
          url: `/api/v1/sessions/${item.sessionId}/similar`,
          headers: { authorization: `Bearer ${first.key}` },
        });
        expect(response.statusCode).toBe(enabled ? 200 : 404);
        const dispatchCount = dispatches.mock.calls.length;
        const searchResponse = await app.inject({
          method: "POST",
          url: "/api/v1/search",
          headers: { authorization: `Bearer ${first.key}` },
          payload: { query: "orchard" },
        });
        expect(searchResponse.statusCode).toBe(200);
        expect(dispatches.mock.calls.length - dispatchCount).toBe(
          enabled ? 1 : 0,
        );
        const config = await app.inject({ method: "GET", url: "/auth/config" });
        expect(
          z.object({ features: z.array(z.string()) }).parse(config.json())
            .features,
        ).toEqual(enabled ? ["similar_sessions"] : []);
        const swagger = await app.inject({
          method: "GET",
          url: "/api/docs/json",
        });
        const paths = z
          .object({ paths: z.record(z.string(), z.unknown()) })
          .parse(swagger.json()).paths;
        expect(
          Object.keys(paths).includes("/api/v1/sessions/{id}/similar"),
        ).toBe(enabled);
        await client.connect(
          new StreamableHTTPClientTransport(new URL(`${address}/mcp`), {
            requestInit: { headers: { authorization: `Bearer ${first.key}` } },
          }) as Transport,
        );
        catalogs.push((await client.listTools()).tools);
      } finally {
        await client.close();
        await app.close();
        await runtime.close();
      }
    }
    expect(catalogs[0]).toEqual(catalogs[1]);
  });
});
