import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { JOB_QUEUES } from "@agentcommons/db";
import { TraceReaders, createTraceClient } from "@agentcommons/traces";
import type { IngestEnvelope } from "@agentcommons/core";
import { startTraceDatabase } from "../../../packages/traces/test/support.js";
import { EmbeddingService } from "../src/embeddings/service.js";
import { FakeEmbeddingProvider } from "../src/embeddings/provider.js";
import { tokenize } from "../src/embeddings/chunker.js";
import { SearchService } from "../src/services/search.js";
import { SimilarService } from "../src/services/similar.js";
import { QueryService } from "../src/services/query.js";
import { CursorCodec } from "../src/services/cursor.js";
import { PolicyService } from "../src/services/policies.js";
import { AdminService } from "../src/services/admin.js";
import { mcpClient, startApp } from "./app.js";
import { testEnvelope, textRecord } from "./envelopes.js";
import {
  provisionOrganization as provisionNativeOrganization,
  releaser,
} from "./support.js";
import { traceServices } from "./trace-services.js";

async function provisionOrganization(
  database: Awaited<ReturnType<typeof startTraceDatabase>>,
  slug: string,
) {
  const account = await provisionNativeOrganization(database, slug);
  const organizationId = z
    .string()
    .parse(account.context.caller?.organizationId);
  await database.prisma.organizationSettings.create({
    data: { organizationId, embeddingsEnabled: true },
  });
  return account;
}
let db: Awaited<ReturnType<typeof startTraceDatabase>>;
let first: Awaited<ReturnType<typeof provisionOrganization>>;
let other: Awaited<ReturnType<typeof provisionOrganization>>;
let readers: TraceReaders;
const provider = new FakeEmbeddingProvider();
let embeddings: EmbeddingService;
let services: ReturnType<typeof traceServices>;
const cursors = new CursorCodec("embedding-test-cursor-key");
const { defer, release } = releaser();
function request(text: string): IngestEnvelope {
  return testEnvelope({
    harnessSessionId: uuidv7(),
    batchId: uuidv7(),
    installationId: uuidv7(),
    context: { installation: { hostname: "host", osUser: "user" } },
    records: [textRecord(0, text)],
    sourcePos: 1,
    cursor: "1",
  });
}
/** An embedding service over the shared database with the deterministic provider. */
function embeddingService(
  embeddingProvider: ConstructorParameters<
    typeof EmbeddingService
  >[0]["provider"],
  dailyTokenBudget = 5_000_000,
) {
  return new EmbeddingService({
    ...db,
    provider: embeddingProvider,
    dailyTokenBudget,
  });
}
/** A search service with no context and the given page size, fused with an embedding service. */
function searchService(limit: number, service: EmbeddingService = embeddings) {
  return new SearchService(
    { ...db, readers, cursors },
    { context: 0, limit },
    service,
  );
}
async function corpus(text: string, account = first) {
  const envelope = request(text);
  const result = await services.publish(account.context, envelope);
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
    const result = await service.process({
      organizationId: data.organizationId,
      sessionId: data.sessionId,
    });
    if (result.complete) return;
    if (result.deferredUntil) throw new Error("Unexpected indexing deferral");
  }
  throw new Error("Index did not finish");
}
async function vectorScope(sessionId: string) {
  const control = await db.prisma.traceSessionControl.findFirstOrThrow({
    where: { id: sessionId },
  });
  return {
    organizationId: control.organizationId,
    sessionId,
    generation: control.redactionGeneration,
    revision: control.embeddingRevision ?? 0n,
  };
}
async function chunksFor(sessionId: string) {
  const current = await vectorScope(sessionId);
  if (current.revision === 0n) return [];
  const items = [];
  let after: string | null = null;
  do {
    const page = await db.traces.embeddingsPage(current, {
      after,
      limit: 1000,
    });
    items.push(...page.items);
    after = page.after;
  } while (after);
  return items;
}
async function summaryFor(sessionId: string) {
  return db.traces.readSessionEmbedding(await vectorScope(sessionId));
}
/** A worker of its own; the caller closes it (which also surfaces its collected errors). */
function worker(service?: EmbeddingService) {
  return traceServices(db, undefined, {
    auditRetentionDays: 30,
    ...(service ? { embeddings: service } : {}),
  });
}
beforeAll(async () => {
  db = await startTraceDatabase();
  defer(() => db.close());
  first = await provisionOrganization(db, "embedding-first");
  other = await provisionOrganization(db, "embedding-other");
  readers = db.traceReaders;

  embeddings = embeddingService(provider);
  await embeddings.initialize();
  services = traceServices(db);
  defer(() => services.close());
});
afterAll(release);

describe("durable organization embedding index", () => {
  it("reserves concurrent query attempts atomically and keeps failed/uncertain reservations charged @req R-EMB-02 @req R-ORG-09", async () => {
    const account = await provisionOrganization(db, "embedding-budget");
    const org = account.context.caller?.organizationId ?? "";
    const limited = embeddingService(provider, 10);
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
    await db.prisma.traceSessionControl.updateMany({
      where: { id: privateRow.sessionId },
      data: { visibility: "PRIVATE" },
    });
    await Promise.all(
      [source, near, privateRow, foreign].map((data) => index(data)),
    );
    const rows = await chunksFor(source.sessionId);
    expect(rows).toHaveLength(1);
    expect(
      rows.every(
        (row) =>
          row.embedding.length === 1024 && row.embedding.every(Number.isFinite),
      ),
    ).toBe(true);
    expect((await summaryFor(source.sessionId))?.embedding).toHaveLength(1024);
    const dependencies = { ...db, readers, cursors };
    const query = new QueryService(dependencies, true);
    if (!first.context.caller) throw new Error("Missing caller");
    await readers.read(first.context.caller, (client) =>
      client.query(
        "SELECT * FROM api_ro.similar_sessions(source={source:UUID},max_rows=50)",
        { source: source.sessionId },
      ),
    );
    const similar = await new SimilarService(dependencies, query).execute(
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
    const visible = await new SimilarService(dependencies, query).execute(
      user,
      source.sessionId,
      {},
    );
    expect(visible.result.sessions.map((row) => row.session_id)).not.toContain(
      privateRow.sessionId,
    );
    await expect(
      new SimilarService(dependencies, query).execute(
        user,
        privateRow.sessionId,
        {},
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
    const sql = await query.execute(first.context, {
      sql: `SELECT * FROM similar_sessions(source='${source.sessionId}',max_rows=50)`,
    });
    expect(JSON.stringify(sql.result)).not.toContain(foreign.sessionId);
    const queryVector = (await provider.embed([tokenize("orchard")]))
      .vectors[0];
    if (!queryVector) throw new Error("Missing query vector");
    const ranking = await readers.read(first.context.caller, async (client) => {
      const lexical = await client.query<{ session_id: string }>(
        "SELECT session_id FROM api_ro.search_messages(q='orchard') ORDER BY rank DESC,session_id,seq",
      );
      const semantic = await client.query<{ session_id: string }>(
        "SELECT c.session_id FROM api_ro.message_chunks c ORDER BY cosineDistance(c.embedding,{vector:Array(Float32)}),c.message_id",
        { vector: queryVector },
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
    const search = searchService(50);
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
    // @req R-SRCH-13: conditions constrain vector eligibility even without lexical hits.
    const condition = { field: "content", op: "contains", value: "orchard" };
    const filteredSemantic = await search.execute(first.context, {
      query: "absentlexicalterm",
      context: 0,
      limit: 50,
      filters: { where: [condition] },
    });
    const eligible = await readers.read(first.context.caller, async (client) =>
      client.query<{ session_id: string }>(
        "SELECT DISTINCT session_id FROM api_ro.messages WHERE position(lowerUTF8(content),'orchard')>0 AND searchable",
      ),
    );
    expect(filteredSemantic.result.blocks.length).toBeGreaterThan(0);
    const eligibleIds = new Set(eligible.rows.map((row) => row.session_id));
    expect(
      filteredSemantic.result.blocks.every((block) =>
        eligibleIds.has(block.session_id),
      ),
    ).toBe(true);
    const excludedSemantic = await search.execute(first.context, {
      query: "orchard",
      filters: {
        where: [
          {
            field: "tool_name",
            op: "eq",
            value: "AbsentToolNoLexicalOrVectorHit",
          },
        ],
      },
    });
    expect(excludedSemantic.result.blocks).toEqual([]);

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
    await services.publish(first.context, {
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
    expect(await summaryFor(item.sessionId)).toBeNull();
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
    const service = embeddingService(slow);
    const work = service.process({
      organizationId: pending.organizationId,
      sessionId: pending.sessionId,
    });
    await began;
    const instance = worker();
    const admin = new AdminService({
      ...db,
      readers,
      cursors,
      jobs: instance.jobs,
    });
    await admin.purge(first.context, {
      session_id: pending.sessionId,
      reason: "Remove test session",
    });
    release();
    await work;
    expect(await summaryFor(pending.sessionId)).toBeNull();
    expect((await chunksFor(pending.sessionId)).length).toBe(0);
    await index(item);
    expect((await chunksFor(item.sessionId)).length).toBe(2);
    await instance.close();
  });
  it("native pg-boss catches up retained sessions when enabled and never indexes when disabled @req R-EMB-01 @req R-EMB-05", async () => {
    const retained = await corpus("retained corpus catchup");
    const off = worker();
    try {
      await off.jobs.start();
      await off.jobs.maintenance();
    } finally {
      await off.close();
    }
    expect(
      await db.prisma.$queryRaw<
        { count: number }[]
      >`SELECT count(*)::int AS count FROM pgboss.job WHERE name=${JOB_QUEUES.embedding} AND data->>'sessionId'=${retained.sessionId}`,
    ).toEqual([{ count: 0 }]);
    expect((await chunksFor(retained.sessionId)).length).toBe(0);
    const disabledReaders = new TraceReaders(db.traceConfig, db.prisma, {
      embeddings: false,
    });
    defer(() => disabledReaders.close());
    const hidden = await disabledReaders.read(
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
      new QueryService({ ...db, readers: disabledReaders, cursors }).execute(
        first.context,
        {
          sql: `SELECT * FROM similar_sessions(source='${retained.sessionId}',max_rows=5)`,
        },
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
    const on = worker(embeddings);
    try {
      await on.jobs.start();
      await expect
        .poll(
          async () =>
            (
              await db.prisma.embeddingState.findUnique({
                where: {
                  organizationId_sessionId: {
                    organizationId: retained.organizationId,
                    sessionId: retained.sessionId,
                  },
                },
              })
            )?.complete,
          { timeout: 20_000, interval: 100 },
        )
        .toBe(true);
      expect(
        (await on.jobs.status(retained.organizationId)).embedding_daily_tokens,
      ).not.toBe("0");
    } finally {
      await on.close();
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
    const noisy = await services.publish(account.context, envelope);
    const quiet = await corpus(
      `noisykeyword ${"padding ".repeat(40)}`,
      account,
    );
    const service = searchService(50);
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
    const search = searchService(1, embeddingService(tracked));
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
    await index(item, embeddingService(tracked));
    expect(
      calls.mock.calls
        .flatMap((call) => call[0])
        .every((input) => !input.content.includes("newlyclassified")),
    ).toBe(true);
    expect(
      (await chunksFor(item.sessionId)).every(
        (row) => !row.content.includes("newlyclassified"),
      ),
    ).toBe(true);
    expect(
      (await services.messages(item.organizationId, item.sessionId)).some(
        (row) => row.search_text.includes("newlyclassified"),
      ),
    ).toBe(true);
  });
  it("rolls back reservations and placeholders before dispatch when its prepare audit fails @req R-EMB-02 @req R-AUD-01", async () => {
    const account = await provisionOrganization(db, "embedding-prepare-audit");
    const item = await corpus("prepare audit corpus", account);
    const tracked = new FakeEmbeddingProvider();
    const calls = vi.spyOn(tracked, "embed");
    const service = embeddingService(tracked);
    const write = db.audit.write.bind(db.audit);
    vi.spyOn(db.audit, "write").mockImplementation(
      async (context, description, tx) => {
        if (description.action === "embeddings.reserve")
          throw new Error("Injected prepare audit failure");
        return write(context, description, tx);
      },
    );
    await expect(
      service.process({
        organizationId: item.organizationId,
        sessionId: item.sessionId,
      }),
    ).rejects.toThrow("Injected prepare audit failure");
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
    expect((await chunksFor(item.sessionId)).length).toBe(0);
    expect(await summaryFor(item.sessionId)).toBeNull();
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
    const service = embeddingService(tracked);
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
    await expect(
      service.process({
        organizationId: item.organizationId,
        sessionId: item.sessionId,
      }),
    ).rejects.toThrow("Embedding publication must retry.");
    const reserved = await db.prisma.embeddingAttempt.findMany({
      where: { organizationId: item.organizationId },
    });
    expect(reserved).toHaveLength(1);
    expect(reserved[0]?.state).toBe("completed");
    expect(await summaryFor(item.sessionId)).toBeNull();
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
    expect(calls).toHaveBeenCalledTimes(1);
    const attempts = await db.prisma.embeddingAttempt.findMany({
      where: { organizationId: item.organizationId },
      orderBy: { createdAt: "asc" },
    });
    expect(attempts.map((attempt) => attempt.state)).toEqual(["completed"]);
    expect(
      (await service.budget.status(item.organizationId)).embedding_daily_tokens,
    ).toBe(String(reserved[0]?.reservedTokens ?? 0));
    expect(
      (
        await db.prisma.auditEvent.findMany({
          where: {
            organizationId: item.organizationId,
            action: "embeddings.index",
          },
          orderBy: [{ ts: "asc" }, { id: "asc" }],
        })
      ).map((event) => event.statusCode),
    ).toEqual([503, 200]);
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
    const instance = worker(embeddings);
    try {
      await instance.jobs.start();
      const admin = new AdminService({
        ...db,
        readers,
        cursors,
        jobs: instance.jobs,
      });
      const run = await admin.rescan(account.owner, {
        reason: "Redact derived embeddings",
      });
      // The run completes and the redacted projection is re-indexed without the phrase.
      await expect
        .poll(
          async () => {
            const progress = (
              await instance.jobs.progress(account.owner, run.result.job_id)
            ).result;
            const state = await db.prisma.embeddingState.findUnique({
              where: {
                organizationId_sessionId: {
                  organizationId: item.organizationId,
                  sessionId: item.sessionId,
                },
              },
            });
            const rows = await chunksFor(item.sessionId);
            return (
              progress.state === "completed" &&
              state?.complete === true &&
              rows.length > 0 &&
              rows.every((row) => !row.content.includes("classifiedphrase"))
            );
          },
          { timeout: 20_000, interval: 100 },
        )
        .toBe(true);
    } finally {
      await instance.close();
    }
  });
  it("persists native next-day deferral without accumulating maintenance duplicates @req R-EMB-02", async () => {
    const account = await provisionOrganization(db, "embedding-deferral");
    const item = await corpus("daily budget deferred corpus", account);
    const limited = embeddingService(provider, 1);
    const instance = worker(limited);
    try {
      await instance.jobs.start();
      // The exhausted budget defers the session to a native delivery after midnight UTC.
      await expect
        .poll(
          async () =>
            Number(
              (
                await db.prisma.$queryRaw<
                  { count: bigint }[]
                >`SELECT count(*) FROM pgboss.job WHERE name='session-embedding' AND data->>'sessionId'=${item.sessionId} AND state='created' AND start_after>now()`
              )[0]?.count ?? 0n,
            ),
          { timeout: 20_000, interval: 100 },
        )
        .toBeGreaterThan(0);
      const before = await db.prisma.$queryRaw<
        { count: bigint }[]
      >`SELECT count(*) FROM pgboss.job WHERE name='session-embedding' AND data->>'sessionId'=${item.sessionId} AND state IN ('created','retry','active')`;
      await instance.jobs.maintenance();
      await instance.jobs.maintenance();
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
      await instance.close();
    }
  });
  it("retains both HNSW indexes on the vector tables", async () => {
    const native = createTraceClient({
      ...db.traceConfig,
      username: db.traceMigration.username,
      password: db.traceMigration.password,
    });
    try {
      const installed = await native.query({
        query:
          "SELECT table,name,type FROM system.data_skipping_indices WHERE database={database:String} AND name='embedding_hnsw' ORDER BY table",
        query_params: { database: db.traceConfig.database },
        format: "JSONEachRow",
      });
      const rows = z
        .array(
          z.object({ table: z.string(), name: z.string(), type: z.string() }),
        )
        .parse(await installed.json());
      expect(rows.map((row) => row.table)).toEqual([
        "message_chunks",
        "session_embeddings",
      ]);
      expect(rows.every((row) => row.type === "vector_similarity")).toBe(true);
    } finally {
      await native.close();
    }
  });
  /** Wall-clock measurement on shared hardware: run with BENCHMARK=1. */
  describe.skipIf(!process.env.BENCHMARK)("embedding search benchmark", () => {
    it("measures exact filtered cosine on a 500-message corpus", async () => {
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
        const accepted = await services.publish(account.context, envelope);
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
        client.query(
          "EXPLAIN SELECT message_id,min(cosineDistance(embedding,{vector:Array(Float32)})) AS distance FROM api_ro.message_chunks GROUP BY message_id ORDER BY distance LIMIT 500",
          { vector },
        ),
      );
      const plan = JSON.stringify(explain.rows);
      expect(plan).toContain("Aggregating");
      const search = searchService(5);
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
        `Embedding experiment ${JSON.stringify({ sessions: 20, messages: 500, native_plan: plan, warm_p50_ms: samples[10], warm_p95_ms: samples[18] })}\n`,
      );
    }, 120_000);
  });
  it("filters the live REST/OpenAPI surface and preserves the actual MCP tool schemas across flags @req R-EMB-01 @req R-EMB-03 @req R-EMB-04", async () => {
    const item = await corpus("route similarity source");
    const neighbor = await corpus("route similarity neighbor");
    await index(item);
    await index(neighbor);
    const catalogs: unknown[] = [];
    const dispatches = vi.spyOn(FakeEmbeddingProvider.prototype, "embed");
    for (const enabled of [false, true]) {
      const server = await startApp(
        db,
        { EMBEDDINGS_ENABLED: String(enabled), EMBEDDINGS_PROVIDER: "fake" },
        { listen: true },
      );
      const { app } = server;
      try {
        const response = await app.inject({
          method: "GET",
          url: `/api/v1/sessions/${item.sessionId}/similar`,
          headers: { authorization: `Bearer ${first.key}` },
        });
        expect(response.statusCode).toBe(enabled ? 200 : 404);
        const queryDispatches = () =>
          dispatches.mock.calls.filter(
            ([inputs]) =>
              inputs.length === 1 && inputs[0]?.content === "orchard",
          ).length;
        const dispatchCount = queryDispatches();
        const searchResponse = await app.inject({
          method: "POST",
          url: "/api/v1/search",
          headers: { authorization: `Bearer ${first.key}` },
          payload: { query: "orchard" },
        });
        expect(searchResponse.statusCode).toBe(200);
        expect(queryDispatches() - dispatchCount).toBe(enabled ? 1 : 0);
        const config = await app.inject({
          method: "GET",
          url: "/auth/config",
          headers: { authorization: `Bearer ${first.key}` },
        });
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
        const client = await mcpClient(server.address, first.key, {
          name: "embedding-contract-test",
        });
        try {
          catalogs.push((await client.listTools()).tools);
        } finally {
          await client.close();
        }
      } finally {
        await server.close();
      }
    }
    expect(catalogs[0]).toEqual(catalogs[1]);
  });
});
