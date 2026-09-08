import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { startTraceDatabase } from "../../../packages/traces/test/support.js";
import { createTraceClient } from "@agentcommons/traces";
import { provisionOrganization } from "./support.js";
import { TraceAuditProjectionService } from "../src/services/trace-audit-projection.js";
import { requireCaller } from "../src/services/context.js";
import { cleanup } from "../../../scripts/cleanup.js";
let db: Awaited<ReturnType<typeof startTraceDatabase>>;
let org: Awaited<ReturnType<typeof provisionOrganization>>;
let projection: TraceAuditProjectionService;
let writer: ReturnType<typeof createTraceClient>;
const release: Array<() => Promise<unknown>> = [];
beforeAll(async () => {
  db = await startTraceDatabase();
  release.unshift(() => db.close());
  org = await provisionOrganization(db, "audit-projection");
  writer = createTraceClient(db.traceConfig);
  release.unshift(() => writer.close());
  projection = new TraceAuditProjectionService({
    prisma: db.prisma,
    audit: db.audit,
    traces: db.traces,
  });
  while (await projection.flush()) {
    /* drain native setup audit */
  }
});
afterAll(async () => {
  expect(await cleanup(release)).toEqual([]);
});
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
