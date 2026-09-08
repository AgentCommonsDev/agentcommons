import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { z } from "zod";
import { type AgentSession } from "@agentcommons/db";
import { startDatabase, provisionOrganization } from "./support.js";
import { requireCaller } from "../src/services/context.js";
import { MetricsService } from "../src/services/metrics.js";
import { CursorCodec } from "../src/services/cursor.js";
import { IngestService } from "../src/services/ingest.js";

let db: Awaited<ReturnType<typeof startDatabase>>;
let org: Awaited<ReturnType<typeof provisionOrganization>>;
let service: MetricsService;
const cleanup: (() => Promise<void>)[] = [];
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
  return db.prisma.agentSession.create({
    data: {
      id: randomUUID(),
      organizationId: caller.organizationId,
      harness: "CLAUDE_CODE",
      harnessSessionId: randomUUID(),
      userId: caller.userId,
      ingestApiKeyId: z.string().parse(caller.apiKeyId),
      installationId,
      cwd: "/test",
      repoName,
      startedAt: at(7, 9),
      endedAt: at(7, 10),
      lastActivityAt: at(7, 10),
      status: "ENDED",
    },
  });
}
async function receipt(
  row: AgentSession,
  behavior: string,
  sentAt: Date,
  sourcePos: number,
  id: string,
  receivedAt = sentAt,
) {
  return db.prisma.ingestBatch.create({
    data: {
      organizationId: row.organizationId,
      id,
      sessionId: row.id,
      apiKeyId: row.ingestApiKeyId,
      userId: row.userId,
      installationId: row.installationId,
      ip: "review",
      cursor: randomUUID(),
      acceptedCount: 0,
      sourcePos,
      sentAt,
      behavior,
      nativeEvent: behavior,
      receivedAt,
      recordCount: 0,
      duplicateCount: 0,
      byteCount: 0,
      redactionCount: 0,
      durationMs: 0,
    },
  });
}
beforeAll(async () => {
  db = await startDatabase();
  cleanup.push(() => db.close());
  org = await provisionOrganization(db, "metrics-review");
  service = new MetricsService({
    ...db,
    cursors: new CursorCodec("metrics-independent-review"),
  });
}, 120_000);
afterAll(async () => {
  for (const close of cleanup.reverse()) await close();
});

it("reports consistent persisted aggregate totals and denominators across sessions", async () => {
  const known = await session("review-known-tokens");
  await session("review-known-tokens");
  await db.prisma.agentSession.update({
    where: { id: known.id },
    data: { inputTokens: 150, outputTokens: 50 },
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
  await db.prisma.agentSession.update({
    where: { id: row.id },
    data: { inputTokens: maximum, outputTokens: maximum },
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
  );
  await receipt(
    row,
    "sync",
    at(7, 10, 2),
    11,
    "00000000-0000-4000-8000-000000000004",
  );
  const windows = await db.readers.read(
    requireCaller(org.context),
    async (client) =>
      (
        await client.query<{ active_from: Date; active_to: Date }>(
          "SELECT active_from,active_to FROM api_ro.metrics_active_windows WHERE session_id=$1",
          [row.id],
        )
      ).rows,
  );
  expect(
    windows.some(
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
  await db.prisma.agentSession.update({
    where: { id: row.id },
    data: { lastActivityAt: at(15, 9) },
  });
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
    await db.readers.read(
      { ...requireCaller(org.context), role: "member" },
      async (client) =>
        (
          await client.query<Record<string, unknown>>(
            "SELECT * FROM api_ro.metrics_activity",
          )
        ).rows,
    ),
  ).toEqual([]);
  await db.prisma.agentSession.update({
    where: { id: row.id },
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
  const ingest = new IngestService(db);
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
  const send = (
    index: number,
    behavior: string,
    sourcePos: number,
    sentAt: Date,
  ) =>
    ingest.execute(org.context, {
      ...base,
      batchId: ids[index],
      behavior,
      nativeEvent: behavior,
      sourcePos,
      sentAt: sentAt.toISOString(),
    });
  await send(0, "start", 0, at(7, 9));
  await send(1, "end", 10, at(7, 10));
  await send(2, "start", 10, at(7, 10));
  await send(3, "sync", 11, at(7, 10, 2));
  const receipts = await db.prisma.ingestBatch.findMany({
    where: {
      organizationId: requireCaller(org.context).organizationId,
      id: { in: ids },
    },
  });
  expect(
    ids.map((id) => receipts.find((row) => row.id === id)?.lifecycleApplied),
  ).toEqual([true, true, false, false]);
  const sessionId = z.string().parse(receipts[0]?.sessionId);
  expect(
    (
      await db.prisma.agentSession.findUniqueOrThrow({
        where: { id: sessionId },
      })
    ).status,
  ).toBe("ENDED");
  // Equal receipt milliseconds cannot be disambiguated by client UUID order.
  await db.prisma.ingestBatch.updateMany({
    where: { id: { in: ids.slice(1, 3) } },
    data: { receivedAt: at(7, 10) },
  });
  const windows = await db.readers.read(
    requireCaller(org.context),
    async (client) =>
      (
        await client.query<{ active_from: Date; active_to: Date }>(
          "SELECT active_from,active_to FROM api_ro.metrics_active_windows WHERE session_id=$1",
          [sessionId],
        )
      ).rows,
  );
  expect(
    windows.some(
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
  await db.prisma.ingestBatch.updateMany({
    where: { id: { in: [start.id, end.id, resume.id] } },
    data: { lifecycleApplied: true },
  });
  const windows = await db.readers.read(
    requireCaller(org.context),
    async (client) =>
      (
        await client.query<{ active_from: Date; active_to: Date }>(
          "SELECT active_from,active_to FROM api_ro.metrics_active_windows WHERE session_id=$1",
          [row.id],
        )
      ).rows,
  );
  expect(
    windows.some(
      (window) =>
        window.active_from <= at(7, 13, 30) && window.active_to > at(7, 13, 30),
    ),
  ).toBe(true);
});
