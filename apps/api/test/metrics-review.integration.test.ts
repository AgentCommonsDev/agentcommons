import { queryTrace } from "@agentcommons/traces";
import { cleanup as cleanupAll } from "../../../scripts/cleanup.js";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { z } from "zod";
import { startTraceDatabase } from "../../../packages/traces/test/support.js";
import { TraceFixtures } from "../../../packages/traces/test/fixtures.js";
import { provisionOrganization } from "./support.js";
import { requireCaller } from "../src/services/context.js";
import { MetricsService } from "../src/services/metrics.js";
import { CursorCodec } from "../src/services/cursor.js";
import { IngestService } from "../src/services/ingest.js";
import { JobService } from "../src/services/jobs.js";
import { TraceProjectionService } from "../src/services/trace-projection.js";
import { TraceAuditProjectionService } from "../src/services/trace-audit-projection.js";

let db: Awaited<ReturnType<typeof startTraceDatabase>>;
let org: Awaited<ReturnType<typeof provisionOrganization>>;
let fixture: TraceFixtures;
let service: MetricsService;
let ingest: IngestService;
let projection: TraceProjectionService;
const cleanup: (() => Promise<unknown>)[] = [];
const workerErrors: Error[] = [];
const at = (day: number, hour = 0, minute = 0) =>
  new Date(Date.UTC(2026, 8, day, hour, minute));
const filters = {
  date_from: at(7).toISOString(),
  date_to: at(14).toISOString(),
};
async function session(repoName: string) {
  const caller = requireCaller(org.context);
  const installationId = randomUUID();
  await db.prisma.installation.create({
    data: {
      id: installationId,
      organizationId: caller.organizationId,
      hostname: repoName,
      osUser: "test",
      platform: "linux",
      arch: "x64",
    },
  });
  const id = await fixture.session({
    organizationId: caller.organizationId,
    userId: caller.userId,
    keyId: z.string().parse(caller.apiKeyId),
    installationId,
    fields: {
      harness: "CLAUDE_CODE",
      repo_name: repoName,
      started_at: at(7, 9),
      ended_at: at(7, 10),
      last_activity_at: at(7, 10),
      status: "ENDED",
    },
  });
  await db.prisma.traceSessionControl.update({
    where: { organizationId_id: { organizationId: caller.organizationId, id } },
    data: {
      startedAt: at(7, 9),
      lastActivityAt: at(7, 10),
      endedAt: at(7, 10),
      status: "ENDED",
    },
  });
  return {
    id,
    organizationId: caller.organizationId,
    userId: caller.userId,
    installationId,
    ingestApiKeyId: z.string().parse(caller.apiKeyId),
    repoName,
  };
}
async function receipt(
  row: Awaited<ReturnType<typeof session>>,
  behavior: string,
  sentAt: Date,
  sourcePos: number,
  id: string,
  receivedAt = sentAt,
  lifecycleApplied = behavior !== "sync",
) {
  await fixture.insert("ingest_receipts", row.id, {
    receipt_id: id,
    installation_id: row.installationId,
    api_key_id: row.ingestApiKeyId,
    user_id: row.userId,
    source_pos: BigInt(sourcePos),
    sent_at: sentAt,
    received_at: receivedAt,
    behavior,
    native_event: behavior,
    lifecycle_applied: lifecycleApplied,
  });
  return { id };
}
async function windows(id: string) {
  return db.traceReaders.read(requireCaller(org.context), async (client) => {
    const rows = (
      await client.query(
        "SELECT active_from,active_to FROM api_ro.metrics_active_windows WHERE session_id={id:UUID}",
        { id },
      )
    ).rows;
    return z
      .array(
        z.object({ active_from: z.coerce.date(), active_to: z.coerce.date() }),
      )
      .parse(rows);
  });
}
beforeAll(async () => {
  db = await startTraceDatabase();
  cleanup.unshift(() => db.close());
  fixture = new TraceFixtures(db);
  cleanup.unshift(() => fixture.close());
  org = await provisionOrganization(db, "metrics-review");
  service = new MetricsService({
    ...db,
    readers: db.traceReaders,
    cursors: new CursorCodec("metrics-independent-review"),
  });
  projection = new TraceProjectionService({
    prisma: db.prisma,
    audit: db.audit,
    repository: db.traces,
  });
  const jobs = new JobService({
    prisma: db.prisma,
    audit: db.audit,
    traces: projection,
    traceAudit: new TraceAuditProjectionService({
      prisma: db.prisma,
      audit: db.audit,
      traces: db.traces,
    }),
    connectionString: db.urls.app,
    auditRetentionDays: 365,
    allowedEmailDomains: [],
    onError: (error) => {
      workerErrors.push(error);
    },
  });
  cleanup.unshift(() => jobs.stop());
  ingest = new IngestService({ ...db, traces: jobs });
}, 120_000);
afterAll(async () => {
  expect(await cleanupAll(cleanup.splice(0))).toEqual([]);
  expect(workerErrors).toEqual([]);
});

it("reports consistent persisted aggregate totals and denominators across sessions", async () => {
  const known = await session("review-known-tokens");
  await session("review-known-tokens");
  await fixture.update("sessions", known.id, {
    input_tokens: 150n,
    output_tokens: 50n,
  });
  const result = await service.get(org.context, "outcomes", {
    filters: {
      ...filters,
      repo_name: "review-known-tokens",
      metric: "tokens_per_session",
    },
  });
  expect(result.result.items).toHaveLength(1);
  expect(result.result.items[0]).toMatchObject({
    value: 100,
    numerator: 200,
    denominator: 2,
  });
});

it("aggregates valid bigint token columns without overflowing their combined total", async () => {
  const row = await session("review-bigint-tokens");
  const maximum = 9223372036854775807n;
  await fixture.update("sessions", row.id, {
    input_tokens: maximum,
    output_tokens: maximum,
  });
  const result = await service.get(org.context, "outcomes", {
    filters: {
      ...filters,
      repo_name: "review-bigint-tokens",
      metric: "tokens_per_session",
    },
  });
  expect(result.result.items[0]).toMatchObject({
    value: Number(maximum * 2n),
    numerator: Number(maximum * 2n),
    denominator: 1,
  });
});

it("does not let an equal-watermark later start reactivate a completed session through a sync observation", async () => {
  const row = await session("review-equal-lifecycle");
  await receipt(
    row,
    "start",
    at(7, 9),
    0,
    "00000000-0000-4000-8000-000000000001",
  );
  await receipt(
    row,
    "end",
    at(7, 10),
    10,
    "00000000-0000-4000-8000-000000000002",
  );
  // IngestService's strict clock comparison ignores this later identical clock.
  await receipt(
    row,
    "start",
    at(7, 10),
    10,
    "00000000-0000-4000-8000-000000000003",
    at(7, 10, 1),
    false,
  );
  await receipt(
    row,
    "sync",
    at(7, 10, 2),
    11,
    "00000000-0000-4000-8000-000000000004",
  );
  const activeWindows = await windows(row.id);
  expect(
    activeWindows.some(
      (window) =>
        window.active_from <= at(7, 10, 3) && window.active_to > at(7, 10, 3),
    ),
  ).toBe(false);
});

// @req R-DASH-13 @req R-DASH-15
it("counts historical capture receipts even when the same session ingests again after the selected interval", async () => {
  const row = await session("review-historical-coverage");
  await receipt(row, "start", at(7, 9), 0, randomUUID());
  await receipt(row, "sync", at(15, 9), 10, randomUUID());
  await fixture.update("sessions", row.id, { last_activity_at: at(15, 9) });
  const result = await service.get(org.context, "health", {
    filters: {
      ...filters,
      repo_name: row.repoName,
      metric: "capture_coverage",
    },
  });
  expect(result.result.items[0]).toMatchObject({
    value: 1,
    numerator: 1,
    denominator: 1,
  });
  expect(
    await db.traceReaders.read(
      { ...requireCaller(org.context), role: "member" },
      async (client) =>
        (await client.query("SELECT * FROM api_ro.metrics_activity")).rows,
    ),
  ).toEqual([]);
  await db.prisma.traceSessionControl.update({
    where: {
      organizationId_id: { organizationId: row.organizationId, id: row.id },
    },
    data: { purgedAt: new Date() },
  });
  const purged = await service.get(org.context, "health", {
    filters: {
      ...filters,
      repo_name: row.repoName,
      metric: "capture_coverage",
    },
  });
  expect(purged.result.items[0]).toMatchObject({ numerator: 0, value: 0 });
});

// @req R-ING-07
it("persists the actual lifecycle decision when opposite events share native and receipt clocks", async () => {
  const base = {
    envelopeVersion: 2,
    harness: "CLAUDE_CODE",
    harnessSessionId: randomUUID(),
    installationId: randomUUID(),
    context: {
      cwd: "/review",
      git: null,
      parentHint: null,
      installation: {
        hostname: "equal-clock-review",
        osUser: "test",
        platform: "linux",
        arch: "x64",
      },
    },
    records: [],
    cursor: "0:0",
    start: null,
    end: null,
  };
  const ids = [
    "00000000-0000-4000-8000-000000000011",
    "00000000-0000-4000-8000-000000000013",
    "00000000-0000-4000-8000-000000000012",
    "00000000-0000-4000-8000-000000000014",
  ];
  const send = async (
    index: number,
    behavior: string,
    sourcePos: number,
    sentAt: Date,
  ) => {
    const accepted = await ingest.execute(org.context, {
      ...base,
      batchId: ids[index],
      behavior,
      nativeEvent: behavior,
      sourcePos,
      sentAt: sentAt.toISOString(),
    });
    await projection.process(
      requireCaller(org.context).organizationId,
      accepted.result.sessionId,
    );
    return accepted;
  };
  await send(0, "start", 0, at(7, 9));
  await send(1, "end", 10, at(7, 10));
  await send(2, "start", 10, at(7, 10));
  await send(3, "sync", 11, at(7, 10, 2));
  const receipts = (
    await queryTrace(
      fixture.client,
      "SELECT * FROM ingest_receipts WHERE receipt_id IN {ids:Array(UUID)} ORDER BY revision DESC LIMIT 1 BY receipt_id",
      { ids },
    )
  ).rows;
  expect(
    ids.map(
      (id) => receipts.find((row) => row.receipt_id === id)?.lifecycle_applied,
    ),
  ).toEqual([true, true, false, false]);
  const sessionId = z.string().parse(receipts[0]?.session_id);
  expect(
    (
      await db.prisma.traceSessionControl.findUniqueOrThrow({
        where: {
          organizationId_id: {
            organizationId: requireCaller(org.context).organizationId,
            id: sessionId,
          },
        },
      })
    ).status,
  ).toBe("ENDED");
  // Re-publish the actual receipt facts with tied observation clocks; their recorded
  // lifecycle decisions must remain authoritative over arbitrary receipt UUID order.
  for (const receipt of receipts.filter((row) =>
    ids.slice(1, 3).includes(z.string().parse(row.receipt_id)),
  )) {
    await fixture.insert("ingest_receipts", sessionId, {
      ...receipt,
      source_pos: z.coerce.bigint().parse(receipt.source_pos),
      byte_count: z.coerce.bigint().parse(receipt.byte_count),
      sent_at: z.coerce.date().parse(receipt.sent_at),
      received_at: at(7, 10),
    });
  }
  const activeWindows = await windows(sessionId);
  expect(
    activeWindows.some(
      (window) =>
        window.active_from <= at(7, 10, 3) && window.active_to > at(7, 10, 3),
    ),
  ).toBe(false);
});

it("does not let an older accepted end close a newer resume when the native clock moves backward", async () => {
  const row = await session("review-backward-native-clock");
  const start = await receipt(row, "start", at(7, 9), 0, randomUUID());
  const end = await receipt(row, "end", at(7, 13), 10, randomUUID(), at(7, 10));
  const resume = await receipt(
    row,
    "start",
    at(7, 12),
    20,
    randomUUID(),
    at(7, 12),
  );
  expect([start.id, end.id, resume.id]).toHaveLength(3);
  const activeWindows = await windows(row.id);
  expect(
    activeWindows.some(
      (window) =>
        window.active_from <= at(7, 13, 30) && window.active_to > at(7, 13, 30),
    ),
  ).toBe(true);
});
