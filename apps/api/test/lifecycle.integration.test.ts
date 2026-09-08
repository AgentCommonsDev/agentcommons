import { cleanup as cleanupAll } from "../../../scripts/cleanup.js";
import { afterAll, beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Prisma } from "@agentcommons/db";
import { ingestEnvelopeSchema } from "@agentcommons/core";
import { IngestService } from "../src/services/ingest.js";
import { projectSession, sourceRecord } from "../src/services/projection.js";
import { startDatabase, provisionOrganization } from "./support.js";
let database: Awaited<ReturnType<typeof startDatabase>>;
let organization: Awaited<ReturnType<typeof provisionOrganization>>;
let other: Awaited<ReturnType<typeof provisionOrganization>>;
let ingest: IngestService;
const record = (pos: number) => ({
  pos,
  key: `record-${String(pos)}`,
  sourceVersion: 0,
  line: JSON.stringify({
    type: "user",
    uuid: `record-${String(pos)}`,
    message: { content: `Native message ${String(pos)}` },
  }),
});
function envelope() {
  return ingestEnvelopeSchema.parse({
    envelopeVersion: 2,
    harness: "CLAUDE_CODE",
    harnessSessionId: randomUUID(),
    behavior: "start",
    start: { resume: false },
    nativeEvent: "SessionStart",
    batchId: randomUUID(),
    installationId: randomUUID(),
    sentAt: "2026-09-01T00:00:00Z",
    sourcePos: 20,
    context: {
      cwd: "/repo",
      installation: {
        hostname: "lifecycle",
        osUser: "test",
        platform: "linux",
        arch: "x64",
      },
      git: null,
      parentHint: null,
    },
    records: [record(0), record(20)],
    cursor: "20",
    end: null,
  });
}
const release: Array<() => Promise<unknown>> = [];
beforeAll(async () => {
  database = await startDatabase();
  release.unshift(() => database.close());
  organization = await provisionOrganization(database, "lifecycle");
  other = await provisionOrganization(database, "lifecycle-other");
  ingest = new IngestService(database);
}, 120_000);
afterAll(async () => {
  expect(await cleanupAll(release.splice(0))).toEqual([]);
});

// @req R-LNK-05
// @req R-ING-07
it("projects explicit empty resumes from durable receipts, preserves identities across late records/replay/rescan, and creates no relationship edge", async () => {
  const initial = envelope();
  const accepted = await ingest.execute(organization.context, initial);
  const id = accepted.result.sessionId;
  const end = {
    ...initial,
    batchId: randomUUID(),
    records: [],
    behavior: "end",
    start: null,
    sentAt: "2026-09-02T00:00:00Z",
  };
  await ingest.execute(organization.context, end);
  const resume = {
    ...initial,
    batchId: randomUUID(),
    records: [],
    start: { resume: true },
    sentAt: "2026-09-05T00:00:00Z",
  };
  expect(
    (await ingest.execute(organization.context, resume)).result,
  ).toMatchObject({ sessionId: id, accepted: 0 });
  const first = await database.prisma.message.findMany({
    where: { sessionId: id },
    orderBy: { seq: "asc" },
  });
  expect(first.map((row) => row.content)).toEqual([
    "Native message 0",
    "Native message 20",
    "Session resumed.",
  ]);
  expect(first[2]).toMatchObject({
    rawRecordId: null,
    ingestBatchId: resume.batchId,
    role: "SYSTEM",
    kind: "META",
    searchable: false,
    searchText: "",
  });
  expect(
    await database.prisma.agentSession.findUnique({ where: { id } }),
  ).toMatchObject({
    status: "ACTIVE",
    messageCount: 3,
    parentSessionId: null,
    parentNativeRef: null,
    parentRelation: null,
  });
  await ingest.execute(organization.context, resume);
  await ingest.execute(organization.context, { ...end, batchId: randomUUID() });
  await ingest.execute(organization.context, {
    ...initial,
    batchId: randomUUID(),
    behavior: "sync",
    start: null,
    records: [record(10)],
    sourcePos: 10,
    sentAt: "2026-09-01T01:00:00Z",
  });
  const second = await database.prisma.message.findMany({
    where: { sessionId: id },
    orderBy: { seq: "asc" },
  });
  expect(second.map((row) => row.content)).toEqual([
    "Native message 0",
    "Native message 10",
    "Native message 20",
    "Session resumed.",
  ]);
  expect(second[3]?.id).toBe(first[2]?.id);
  expect(second[0]?.id).toBe(first[0]?.id);
  expect(
    await database.prisma.rawRecord.count({ where: { sessionId: id } }),
  ).toBe(3);
  await database.prisma.$transaction(async (tx) => {
    const session = await tx.agentSession.findUniqueOrThrow({ where: { id } });
    await projectSession(
      tx,
      session,
      (await tx.rawRecord.findMany({ where: { sessionId: id } })).map(
        sourceRecord,
      ),
      { rescan: true },
    );
  });
  expect(
    (
      await database.prisma.message.findMany({
        where: { sessionId: id },
        orderBy: { seq: "asc" },
      })
    ).map((row) => row.id),
  ).toEqual(second.map((row) => row.id));
  const visible = await database.readers.read(
    organization.context.caller ??
      (() => {
        throw new Error("Missing caller");
      })(),
    (client) =>
      client.query(
        "SELECT raw_record_id,ingest_batch_id FROM messages WHERE message_id=$1",
        [first[2]?.id],
      ),
  );
  expect(visible.rows).toEqual([
    { raw_record_id: null, ingest_batch_id: resume.batchId },
  ]);
});

it("does not infer resume markers from startup or unknown starts and orders multiple same-watermark resumes by source time", async () => {
  const initial = envelope();
  initial.records = [];
  const id = (await ingest.execute(organization.context, initial)).result
    .sessionId;
  await ingest.execute(organization.context, {
    ...initial,
    batchId: randomUUID(),
    sentAt: "2026-09-02T00:00:00Z",
  });
  await ingest.execute(organization.context, {
    ...initial,
    batchId: randomUUID(),
    start: null,
    sentAt: "2026-09-03T00:00:00Z",
  });
  expect(
    await database.prisma.message.count({ where: { sessionId: id } }),
  ).toBe(0);
  const late = {
    ...initial,
    batchId: randomUUID(),
    start: { resume: true },
    sentAt: "2026-09-07T00:00:00Z",
  };
  const early = {
    ...initial,
    batchId: randomUUID(),
    start: { resume: true },
    sentAt: "2026-09-06T00:00:00Z",
  };
  await ingest.execute(organization.context, late);
  await ingest.execute(organization.context, early);
  expect(
    (
      await database.prisma.message.findMany({
        where: { sessionId: id },
        orderBy: { seq: "asc" },
      })
    ).map((row) => row.ingestBatchId),
  ).toEqual([early.batchId, late.batchId]);
});

it("enforces exactly one source, META-only receipt provenance and same-organization/session foreign keys", async () => {
  const initial = envelope();
  const id = (await ingest.execute(organization.context, initial)).result
    .sessionId;
  const native = await database.prisma.message.findFirstOrThrow({
    where: { sessionId: id },
  });
  const base = { ...native, id: randomUUID(), toolInput: Prisma.DbNull };
  await expect(
    database.prisma.message.create({ data: { ...base, rawRecordId: null } }),
  ).rejects.toThrow();
  await expect(
    database.prisma.message.create({
      data: { ...base, ingestBatchId: initial.batchId },
    }),
  ).rejects.toThrow();
  await expect(
    database.prisma.message.create({
      data: { ...base, rawRecordId: null, ingestBatchId: initial.batchId },
    }),
  ).rejects.toThrow();
  const foreign = envelope();
  await ingest.execute(other.context, foreign);
  await expect(
    database.prisma.message.create({
      data: {
        ...base,
        role: "SYSTEM",
        kind: "META",
        searchable: false,
        rawRecordId: null,
        ingestBatchId: foreign.batchId,
      },
    }),
  ).rejects.toThrow();
});

it("shows an empty resume on the last displayed pi branch while a newer leaf is pending", async () => {
  const initial = {
    ...envelope(),
    harness: "PI",
    records: [
      {
        pos: 0,
        sourceVersion: 0,
        key: "a",
        line: JSON.stringify({
          type: "message",
          id: "a",
          parentId: null,
          message: {
            role: "user",
            content: [{ type: "text", text: "Visible prior branch" }],
          },
        }),
      },
    ],
    context: { ...envelope().context, activeLeafId: "a" },
  };
  const id = (await ingest.execute(organization.context, initial)).result
    .sessionId;
  const pending = {
    ...initial,
    batchId: randomUUID(),
    records: [],
    start: { resume: true },
    sentAt: "2026-09-04T00:00:00Z",
    context: { ...initial.context, activeLeafId: "not-arrived" },
  };
  await ingest.execute(organization.context, pending);
  expect(
    (
      await database.prisma.message.findMany({
        where: { sessionId: id },
        orderBy: { seq: "asc" },
      })
    ).map((row) => row.content),
  ).toEqual(["Visible prior branch", "Session resumed."]);
  expect(
    await database.prisma.agentSession.findUnique({ where: { id } }),
  ).toMatchObject({
    normalizerContext: { activeLeafId: "not-arrived" },
    projectedContext: { activeLeafId: "a" },
    messageCount: 2,
  });
});
