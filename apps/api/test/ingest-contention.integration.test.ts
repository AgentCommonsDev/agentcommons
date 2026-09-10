import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "@clickhouse/client";
import { afterAll, beforeAll, expect, it } from "vitest";
import { z } from "zod";
import { lockTracePublication } from "@agentcommons/db";
import type { IngestEnvelope } from "@agentcommons/core";
import { startTraceDatabase } from "../../../packages/traces/test/support.js";
import { traceServices } from "./trace-services.js";
import { provisionOrganization, releaser } from "./support.js";
import { testEnvelope, textRecord } from "./envelopes.js";
import { requireCaller } from "../src/services/context.js";

let db: Awaited<ReturnType<typeof startTraceDatabase>>;
let services: ReturnType<typeof traceServices>;
let organization: Awaited<ReturnType<typeof provisionOrganization>>;
let organizationId: string;
const { defer, release } = releaser();
beforeAll(async () => {
  db = await startTraceDatabase();
  defer(() => db.close());
  organization = await provisionOrganization(db, "ingest-contention");
  organizationId = requireCaller(organization.context).organizationId;
  services = traceServices(db);
  defer(() => services.close());
}, 120_000);
afterAll(release);

/** A fresh session's first batch: `count` user messages at positions 0..count-1. */
function firstBatch(count: number): IngestEnvelope {
  const records = Array.from({ length: count }, (_, pos) =>
    textRecord(pos, `Message ${String(pos)}`),
  );
  return testEnvelope({ records, sourcePos: count });
}
/** A later batch of the same session carrying `records` (or none) at `sourcePos`. */
function later(
  base: IngestEnvelope,
  records: IngestEnvelope["records"],
  sourcePos: number,
  extra: Partial<IngestEnvelope> = {},
): IngestEnvelope {
  return {
    ...base,
    ...extra,
    batchId: randomUUID(),
    sentAt: new Date(Date.parse(base.sentAt) + 1000).toISOString(),
    sourcePos,
    records,
    cursor: `${String(sourcePos)}:${String(records.length)}`,
  };
}
function control(sessionId: string) {
  return db.prisma.traceSessionControl.findUniqueOrThrow({
    where: { organizationId_id: { organizationId, id: sessionId } },
  });
}
/**
 * Holds `take` inside a side transaction until `release` is called; resolves with the
 * holder's backend pid so blocked backends can be observed through `pg_blocking_pids`.
 */
async function hold(
  take: (
    tx: Parameters<Parameters<typeof db.prisma.$transaction>[0]>[0],
  ) => Promise<void>,
) {
  let releaseHold: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    releaseHold = resolve;
  });
  let announce: (pid: number) => void = () => {};
  const announced = new Promise<number>((resolve) => {
    announce = resolve;
  });
  const transaction = db.prisma.$transaction(
    async (tx) => {
      await take(tx);
      const rows = await tx.$queryRaw<
        { pid: number }[]
      >`SELECT pg_backend_pid() AS pid`;
      announce(z.number().parse(rows[0]?.pid));
      await held;
    },
    { timeout: 60_000 },
  );
  const pid = await announced;
  return {
    pid,
    release: async () => {
      releaseHold();
      await transaction;
    },
  };
}
async function blockedBy(pid: number): Promise<number> {
  const rows = await db.prisma.$queryRaw<
    { blocked: bigint }[]
  >`SELECT count(*) AS blocked FROM pg_stat_activity WHERE ${pid}::int=ANY(pg_blocking_pids(pid))`;
  return Number(rows[0]?.blocked ?? 0n);
}
async function clickhouseReceipts(sessionId: string): Promise<number> {
  const raw = createClient({
    url: db.traceMigration.url,
    username: db.traceMigration.username,
    password: db.traceMigration.password,
  });
  try {
    const response = await raw.query({
      query:
        "SELECT uniqExact(receipt_id) AS receipts FROM ac_trace.ingest_receipts WHERE organization_id={organization:String} AND session_id={session:UUID}",
      query_params: { organization: organizationId, session: sessionId },
      format: "JSONEachRow",
    });
    const rows = z
      .array(z.object({ receipts: z.coerce.number() }))
      .parse(await response.json());
    return rows[0]?.receipts ?? 0;
  } finally {
    await raw.close();
  }
}

// @req R-ING-19 @req R-ING-02 @req R-ING-04 @req R-AUD-01
it("records an empty sync without the fence, a revision or an outbox, and ships its receipt with the next publish", async () => {
  const initial = firstBatch(2);
  const accepted = await services.publish(organization.context, initial);
  const id = accepted.result.sessionId;
  const before = await control(id);
  expect(before).toMatchObject({ acceptedRevision: 1n, publishedRevision: 1n });

  // Another transaction holds the fence exclusively for the whole empty accept.
  const fence = await hold((tx) =>
    lockTracePublication(tx, organizationId, "write"),
  );
  try {
    const empty = later(initial, [], 2);
    const result = await services.ingest.execute(organization.context, empty);
    expect(result.result).toMatchObject({
      accepted: 0,
      duplicates: 0,
      publication: "published",
      sessionId: id,
    });
    const replay = await services.ingest.execute(organization.context, empty);
    expect(replay.result).toEqual(result.result);
    expect(replay.audit.detail).toMatchObject({ replay: true });
    const after = await control(id);
    expect(after).toMatchObject({
      acceptedRevision: 1n,
      publishedRevision: 1n,
      projectionState: "published",
      contextPos: 2n,
      contextAt: new Date(empty.sentAt),
    });
    expect(after.lastActivityAt.getTime()).toBeGreaterThan(
      before.lastActivityAt.getTime(),
    );
    expect(
      await db.prisma.traceOutbox.count({
        where: { organizationId, sessionId: id },
      }),
    ).toBe(0);
    const receipt = await db.prisma.traceReceipt.findUniqueOrThrow({
      where: { organizationId_id: { organizationId, id: empty.batchId } },
    });
    expect(receipt).toMatchObject({
      revision: 1n,
      publishedAt: null,
      acceptedCount: 0,
      lifecycleApplied: false,
      behavior: "sync",
    });
    expect(
      (
        await db.prisma.installation.findUniqueOrThrow({
          where: {
            organizationId_id: { organizationId, id: empty.installationId },
          },
        })
      ).lastSeenAt.getTime(),
    ).toBe(receipt.receivedAt.getTime());
    // A duplicate-only batch is the same fast path: nothing new was accepted.
    const duplicates = later(initial, initial.records, 2);
    const duplicated = await services.ingest.execute(
      organization.context,
      duplicates,
    );
    expect(duplicated.result).toMatchObject({
      accepted: 0,
      duplicates: 2,
      publication: "published",
    });
    expect((await control(id)).acceptedRevision).toBe(1n);
    expect(await clickhouseReceipts(id)).toBe(1);
  } finally {
    await fence.release();
  }

  // The worker's next run appends the waiting receipts at the published revision
  // (receipt-only publication: no revision, no projection rebuild) and marks them.
  await services.projection.process(organizationId, id);
  expect(await control(id)).toMatchObject({
    acceptedRevision: 1n,
    publishedRevision: 1n,
  });
  const appended = await db.prisma.traceReceipt.findMany({
    where: { organizationId, sessionId: id },
  });
  expect(appended).toHaveLength(3);
  expect(appended.every((row) => row.publishedAt !== null)).toBe(true);
  expect(await clickhouseReceipts(id)).toBe(3);
  const beforeNext = await db.prisma.auditEvent.count({
    where: { organizationId, action: "trace.publish" },
  });

  // A content publish carries any receipt still waiting and appends its own.
  const next = later(initial, [textRecord(2, "Message 2")], 3);
  await services.publish(organization.context, next);
  expect(await control(id)).toMatchObject({
    acceptedRevision: 2n,
    publishedRevision: 2n,
  });
  const receipts = await db.prisma.traceReceipt.findMany({
    where: { organizationId, sessionId: id },
  });
  expect(receipts).toHaveLength(4);
  expect(receipts.every((row) => row.publishedAt !== null)).toBe(true);
  expect(await clickhouseReceipts(id)).toBe(4);
  expect(
    await db.prisma.auditEvent.count({
      where: { organizationId, action: "trace.publish" },
    }),
  ).toBe(beforeNext + 1);
  expect(
    (await services.messages(organizationId, id)).map((row) => row.content),
  ).toEqual(["Message 0", "Message 1", "Message 2"]);

  // A changed parent hint on an otherwise empty sync is a graph update: full path.
  const hinted = later(initial, [], 3, {
    context: {
      ...initial.context,
      parentHint: { harnessSessionId: randomUUID(), relation: "SPAWNED" },
    },
  });
  const linked = await services.ingest.execute(organization.context, hinted);
  expect(linked.result.publication).toBe("queued");
  expect(await control(id)).toMatchObject({
    acceptedRevision: 3n,
    parentRelation: "SPAWNED",
  });
  expect(
    await db.prisma.traceOutbox.count({
      where: { organizationId, sessionId: id },
    }),
  ).toBe(1);
});

// @req R-ING-20 @req R-ING-02
it("publishes while another transaction holds the organization row, and an accept waits for the fence only at its writes", async () => {
  const initial = firstBatch(1);
  const queued = await services.ingest.execute(organization.context, initial);
  const id = queued.result.sessionId;
  expect((await control(id)).publishedRevision).toBe(0n);
  const organizationRow = await hold(async (tx) => {
    await tx.$queryRaw`SELECT id FROM organization WHERE id=${organizationId} FOR NO KEY UPDATE`;
  });
  try {
    await services.projection.process(organizationId, id);
    expect((await control(id)).publishedRevision).toBe(1n);
  } finally {
    await organizationRow.release();
  }

  const fence = await hold((tx) =>
    lockTracePublication(tx, organizationId, "write"),
  );
  const pending = services.ingest.execute(
    organization.context,
    later(initial, [textRecord(1, "Message 1")], 2),
  );
  try {
    await expect
      .poll(() => blockedBy(fence.pid), { timeout: 10_000, interval: 25 })
      .toBeGreaterThan(0);
    // Redaction and validation finished; the revision bump waits for the fence.
    expect((await control(id)).acceptedRevision).toBe(1n);
    await delay(200);
    expect((await control(id)).acceptedRevision).toBe(1n);
  } finally {
    await fence.release();
  }
  const accepted = await pending;
  expect(accepted.result).toMatchObject({ accepted: 1, publication: "queued" });
  expect((await control(id)).acceptedRevision).toBe(2n);
});

// @req R-ING-20 @req R-ING-04 @req R-ING-08
it("serializes concurrent accepts per session with consecutive revisions and exact admissions while sessions of one organization accept together", async () => {
  const sessions = Array.from({ length: 6 }, () => firstBatch(3));
  const results = await Promise.all(
    sessions.map((envelope) =>
      services.ingest.execute(organization.context, envelope),
    ),
  );
  const ids = new Set(results.map((result) => result.result.sessionId));
  expect(ids.size).toBe(6);
  for (const result of results)
    expect(result.result).toMatchObject({ accepted: 3, publication: "queued" });
  expect(
    await db.prisma.traceOutbox.count({
      where: { organizationId, sessionId: { in: [...ids] } },
    }),
  ).toBe(6);

  const base = sessions[0];
  if (!base) throw new Error("A base envelope is required.");
  const id = results[0]?.result.sessionId ?? "";
  const batches = [
    later(base, [textRecord(3, "Message 3"), textRecord(4, "Message 4")], 5),
    later(base, [textRecord(5, "Message 5"), textRecord(6, "Message 6")], 7),
    later(base, [textRecord(7, "Message 7"), textRecord(8, "Message 8")], 9),
  ];
  const concurrent = await Promise.all(
    batches.map((batch) =>
      services.ingest.execute(organization.context, batch),
    ),
  );
  for (const result of concurrent)
    expect(result.result).toMatchObject({ accepted: 2, duplicates: 0 });
  const receipts = await db.prisma.traceReceipt.findMany({
    where: { organizationId, sessionId: id },
    orderBy: { revision: "asc" },
  });
  expect(receipts.map((row) => row.revision)).toEqual([1n, 2n, 3n, 4n]);
  expect(
    await db.prisma.traceSourceAdmission.count({
      where: { organizationId, sessionId: id },
    }),
  ).toBe(9);
  expect((await control(id)).acceptedRevision).toBe(4n);

  // The same batch retried concurrently is accepted once and replayed otherwise.
  const retried = later(base, [textRecord(9, "Message 9")], 10);
  const replays = await Promise.all(
    [0, 1, 2].map(() => services.ingest.execute(organization.context, retried)),
  );
  for (const replay of replays)
    expect(replay.result).toEqual({
      publication: "queued",
      sessionId: id,
      accepted: 1,
      duplicates: 0,
      cursor: retried.cursor,
    });
  expect(
    await db.prisma.traceReceipt.count({
      where: { organizationId, id: retried.batchId },
    }),
  ).toBe(1);
  expect((await control(id)).acceptedRevision).toBe(5n);
  await services.projection.process(organizationId, id);
  expect(
    (await services.messages(organizationId, id)).map((row) => row.content),
  ).toEqual(Array.from({ length: 10 }, (_, pos) => `Message ${String(pos)}`));
});
