import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { startTraceDatabase } from "../../../packages/traces/test/support.js";
import { TraceFixtures } from "../../../packages/traces/test/fixtures.js";
import {
  createTraceClient,
  NO_TARGET_SESSION_ID,
  SESSION_READS_BACKFILL,
  type TraceAudit,
} from "@agentcommons/traces";
import { MetricsFixtures, metricsAt } from "./metrics-fixtures.js";
import { provisionOrganization, releaser } from "./support.js";
import { drainTraceAudit } from "./trace-services.js";
import { TraceAuditProjectionService } from "../src/services/trace-audit-projection.js";
import { requireCaller } from "../src/services/context.js";
let db: Awaited<ReturnType<typeof startTraceDatabase>>;
let org: Awaited<ReturnType<typeof provisionOrganization>>;
let projection: TraceAuditProjectionService;
let writer: ReturnType<typeof createTraceClient>;
const { defer, release } = releaser();
beforeAll(async () => {
  db = await startTraceDatabase();
  defer(() => db.close());
  org = await provisionOrganization(db, "audit-projection");
  writer = createTraceClient(db.traceConfig);
  defer(() => writer.close());
  projection = new TraceAuditProjectionService({
    prisma: db.prisma,
    audit: db.audit,
    traces: db.traces,
    readers: db.traceReaders,
  });
  await drainTraceAudit(projection);
});
afterAll(release);
async function event() {
  return db.audit.write(
    { ...org.context, requestId: randomUUID() },
    {
      action: "search",
      detail: {
        input: { query: "audit-marker" },
        result: { hits: 0, truncated_response: false },
      },
    },
  );
}
async function stored(id: string) {
  const response = await writer.query({
    query:
      "SELECT audit_id,user_email,detail FROM audit_events FINAL WHERE audit_id={id:UUID}",
    query_params: { id },
    format: "JSONEachRow",
  });
  return response.json<Record<string, unknown>>();
}
// @req R-AUD-01 @req R-AUD-04
it("commits an audit with its durable projection and retries a lost native acknowledgement without duplicates", async () => {
  const audit = await event();
  expect(
    await db.prisma.traceAuditOutbox.count({ where: { auditId: audit.id } }),
  ).toBe(1);
  const original = db.traces.appendAudit.bind(db.traces);
  const failure = vi
    .spyOn(db.traces, "appendAudit")
    .mockImplementationOnce(async (rows) => {
      await original(rows);
      throw new Error("Injected lost audit acknowledgement");
    });
  await expect(projection.flush()).rejects.toMatchObject({ audited: true });
  failure.mockRestore();
  expect(
    await db.prisma.traceAuditOutbox.count({ where: { auditId: audit.id } }),
  ).toBe(1);
  expect(await projection.flush()).toBe(1);
  expect(await stored(audit.id)).toHaveLength(1);
  expect((await stored(audit.id))[0]?.user_email).toBe(org.email);
  expect(
    await db.prisma.traceAuditOutbox.count({ where: { auditId: audit.id } }),
  ).toBe(0);
});
// @req R-AUD-01
it("rolls back audit and outbox together and gives concurrent publishers disjoint locked batches", async () => {
  const requestId = randomUUID();
  await expect(
    db.prisma.$transaction(async (tx) => {
      await db.audit.write(
        { ...org.context, requestId },
        { action: "test.rollback" },
        tx,
      );
      throw new Error("rollback");
    }),
  ).rejects.toThrow("rollback");
  expect(await db.prisma.auditEvent.count({ where: { requestId } })).toBe(0);
  const events = await Promise.all([event(), event(), event(), event()]);
  const counts = await Promise.all([projection.flush(2), projection.flush(2)]);
  expect(counts.reduce((a, b) => a + b, 0)).toBe(4);
  for (const row of events) expect(await stored(row.id)).toHaveLength(1);
});
// @req R-AUD-05 @req R-GET-04 @req R-DASH-17
it("credits each projected read to the one session nearest it on the calling installation, only after the key's MCP handshake, and re-derives retained history once per rule", async () => {
  const fixtures = new TraceFixtures(db);
  defer(() => fixtures.close());
  const metrics = new MetricsFixtures(db, fixtures);
  const caller = requireCaller(org.context);
  const start = metricsAt(7, 9);
  const end = metricsAt(7, 10);
  const source = await metrics.session(org.context, {
    start,
    end,
    repo: "reader",
  });
  await metrics.receipt(source, {
    behavior: "start",
    sentAt: start,
    sourcePos: 0,
    control: true,
  });
  await metrics.receipt(source, {
    behavior: "end",
    sentAt: end,
    sourcePos: 10,
    control: true,
  });
  const target = await metrics.session(org.context, {
    start: metricsAt(7, 7),
    end: metricsAt(7, 8),
    repo: "prior",
  });
  // A second session on the same installation, started while the source is active and
  // observed again at 9:44, so a read at 9:45 is nearest to it and one at 9:30 is not.
  const sibling = await metrics.session(org.context, {
    start: metricsAt(7, 9, 41),
    end: metricsAt(7, 12),
    repo: "sibling",
    installationId: source.installationId,
  });
  await metrics.receipt(sibling, {
    behavior: "start",
    sentAt: metricsAt(7, 9, 41),
    sourcePos: 0,
    control: true,
  });
  await metrics.receipt(sibling, {
    behavior: "sync",
    sentAt: metricsAt(7, 9, 44),
    sourcePos: 3,
  });
  await metrics.receipt(sibling, {
    behavior: "end",
    sentAt: metricsAt(7, 12),
    sourcePos: 10,
    control: true,
  });
  /**
   * A successful key-authenticated read from the source's installation at `time`; MCP
   * from the caller's key unless told otherwise.
   */
  async function read(
    time: Date,
    options: {
      action?: "get" | "search" | "mcp.tools.list";
      queue?: boolean;
      transport?: "mcp" | "rest";
      apiKeyId?: string;
    } = {},
  ) {
    const action = options.action ?? "get";
    const row = await db.prisma.auditEvent.create({
      data: {
        organizationId: caller.organizationId,
        id: randomUUID(),
        ts: time,
        requestId: randomUUID(),
        userId: caller.userId,
        apiKeyId: options.apiKeyId ?? caller.apiKeyId,
        installationId: source.installationId,
        authMethod: "key",
        ip: "fixture",
        transport: options.transport ?? "mcp",
        action,
        statusCode: 200,
        durationMs: 1,
        resourceIds: action === "get" ? [target.id] : [],
        detail: {
          input: {},
          result: action === "get" ? { session_id: target.id } : { hits: 0 },
        },
      },
    });
    if (options.queue ?? true)
      await db.prisma.traceAuditOutbox.create({ data: { auditId: row.id } });
    return row;
  }
  /** The audit row as an earlier release projected it: in ClickHouse, never attributed. */
  function projected(row: Awaited<ReturnType<typeof read>>): TraceAudit {
    return {
      id: row.id,
      organization_id: caller.organizationId,
      ts: row.ts,
      user_id: row.userId,
      user_email: org.email,
      api_key_id: row.apiKeyId,
      installation_id: row.installationId,
      auth_method: row.authMethod,
      transport: row.transport,
      action: row.action,
      resource_ids: row.resourceIds,
      status_code: row.statusCode,
      duration_ms: row.durationMs,
      detail: { result: { session_id: target.id } },
    };
  }
  async function storedReads(auditId: string) {
    const response = await writer.query({
      query:
        "SELECT session_id,target_session_id,action FROM session_reads FINAL WHERE audit_id={id:UUID}",
      query_params: { id: auditId },
      format: "JSONEachRow",
    });
    return response.json<Record<string, unknown>>();
  }
  // The key's MCP handshake on this installation; reads before it are not agent calls.
  const early = await read(metricsAt(7, 9, 5), { action: "search" });
  await read(metricsAt(7, 9, 6), { action: "mcp.tools.list" });
  const inside = await read(metricsAt(7, 9, 30));
  const outside = await read(metricsAt(7, 13));
  const search = await read(metricsAt(7, 9, 29), { action: "search" });
  const rest = await read(metricsAt(7, 9, 32), { transport: "rest" });
  const stranger = await read(metricsAt(7, 9, 33), {
    apiKeyId: randomUUID(),
  });
  // Both windows hold 9:45; the sibling's 9:44 receipt is the nearest observation.
  const shared = await read(metricsAt(7, 9, 45), { action: "search" });
  await drainTraceAudit(projection);
  expect(await storedReads(inside.id)).toEqual([
    { session_id: source.id, target_session_id: target.id, action: "get" },
  ]);
  expect(await storedReads(outside.id)).toEqual([]);
  expect(await storedReads(search.id)).toEqual([
    {
      session_id: source.id,
      target_session_id: NO_TARGET_SESSION_ID,
      action: "search",
    },
  ]);
  expect(await storedReads(shared.id)).toEqual([
    {
      session_id: sibling.id,
      target_session_id: NO_TARGET_SESSION_ID,
      action: "search",
    },
  ]);
  // Before the handshake, over REST, or from a key that never handshook: not credited.
  expect(await storedReads(early.id)).toEqual([]);
  expect(await storedReads(rest.id)).toEqual([]);
  expect(await storedReads(stranger.id)).toEqual([]);
  const views = await db.traceReaders.read(caller, async (client) => ({
    edges: (
      await client.query(
        "SELECT source_session_id,target_session_id,audit_id,reader_harness FROM api_ro.reuse_edges WHERE target_session_id={id:UUID}",
        { id: target.id },
      )
    ).rows,
    header: (
      await client.query(
        "SELECT reuse_count FROM api_ro.sessions WHERE session_id={id:UUID}",
        { id: target.id },
      )
    ).rows,
    reuse: (
      await client.query(
        "SELECT reuse_count,unique_readers,cross_user_reuse_count FROM api_ro.session_reuse WHERE session_id={id:UUID}",
        { id: target.id },
      )
    ).rows,
    flags: (
      await client.query(
        "SELECT reused,memory_assisted FROM api_ro.metrics_reuse_sessions WHERE session_id={id:UUID}",
        { id: source.id },
      )
    ).rows,
  }));
  expect(views.edges).toEqual([
    {
      source_session_id: source.id,
      target_session_id: target.id,
      audit_id: inside.id,
      reader_harness: "CLAUDE_CODE",
    },
  ]);
  expect(views.header).toEqual([{ reuse_count: "1" }]);
  expect(views.reuse).toEqual([
    { reuse_count: "1", unique_readers: "1", cross_user_reuse_count: "0" },
  ]);
  expect(views.flags).toEqual([{ reused: 1, memory_assisted: 1 }]);
  // A deployment that projected audit rows before session_reads existed holds them in the
  // native audit copy without attribution; maintenance derives those rows exactly once
  // per rule, clearing what an earlier rule credited: a fanned-out row for the shared
  // read disappears while the flush's rows are written again.
  const historical = await read(metricsAt(7, 9, 20), { queue: false });
  await db.traces.appendAudit([projected(historical)]);
  await db.traces.appendSessionReads([
    {
      organization_id: caller.organizationId,
      session_id: source.id,
      audit_id: shared.id,
      read_at: shared.ts,
      action: "search",
      target_session_id: NO_TARGET_SESSION_ID,
      reader_user_id: caller.userId,
      reader_email: org.email,
      reader_harness: "CLAUDE_CODE",
    },
  ]);
  expect((await storedReads(shared.id)).length).toBe(2);
  expect(await db.traces.backfillCompleted(SESSION_READS_BACKFILL)).toBe(false);
  await projection.backfill();
  expect(await storedReads(historical.id)).toEqual([
    { session_id: source.id, target_session_id: target.id, action: "get" },
  ]);
  expect(await storedReads(inside.id)).toEqual([
    { session_id: source.id, target_session_id: target.id, action: "get" },
  ]);
  expect(await storedReads(shared.id)).toEqual([
    {
      session_id: sibling.id,
      target_session_id: NO_TARGET_SESSION_ID,
      action: "search",
    },
  ]);
  expect(await db.traces.backfillCompleted(SESSION_READS_BACKFILL)).toBe(true);
  const later = await read(metricsAt(7, 9, 50), { queue: false });
  await db.traces.appendAudit([projected(later)]);
  await projection.backfill();
  expect(await storedReads(later.id)).toEqual([]);
  expect(
    await db.prisma.auditEvent.count({
      where: { action: "audit.projection.backfill" },
    }),
  ).toBe(1);
});
// @req R-AUD-03 @req R-SEC-02
it("applies the fresh retention fence before physical ClickHouse audit cleanup", async () => {
  await event();
  await projection.flush();
  const caller = requireCaller(org.context);
  const count = () =>
    db.traceReaders.read(caller, (client) =>
      client.query("SELECT count() AS count FROM metrics_own_zero_results"),
    );
  expect(Number((await count()).rows[0]?.count)).toBeGreaterThan(0);
  const retainedAfter = new Date(Date.now() + 60_000);
  await db.prisma.$transaction(async (tx) => {
    await tx.traceAnalyticsRetention.update({
      where: { id: 1 },
      data: { retainedAfter },
    });
    await tx.auditEvent.deleteMany({ where: { ts: { lt: retainedAfter } } });
  });
  expect(Number((await count()).rows[0]?.count)).toBe(0);
});
