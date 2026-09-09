import { cleanup as cleanupAll } from "../../../scripts/cleanup.js";
import { afterAll, beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { requireCaller } from "../src/services/context.js";
import { startTraceDatabase } from "../../../packages/traces/test/support.js";
import { traceServices } from "./trace-services.js";
import { ingestEnvelopeSchema } from "@agentcommons/core";
import { z } from "zod";
import { provisionOrganization } from "./support.js";
import { SessionService } from "../src/services/session.js";
import { CursorCodec } from "../src/services/cursor.js";
let database: Awaited<ReturnType<typeof startTraceDatabase>>;
let organization: Awaited<ReturnType<typeof provisionOrganization>>;
let other: Awaited<ReturnType<typeof provisionOrganization>>;
let services: ReturnType<typeof traceServices>;
let organizationId: string;
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
    hook: { sha256: "a".repeat(64), extensionSha256: null },
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
  database = await startTraceDatabase();
  release.unshift(() => database.close());
  organization = await provisionOrganization(database, "lifecycle");
  other = await provisionOrganization(database, "lifecycle-other");
  organizationId = requireCaller(organization.context).organizationId;
  services = traceServices(database);
  release.unshift(() => services.close());
}, 120_000);
afterAll(async () => {
  expect(await cleanupAll(release.splice(0))).toEqual([]);
});

// @req R-LNK-05
// @req R-ING-07
it("projects explicit empty resumes from durable receipts, preserves identities across late records/replay/rescan, and creates no relationship edge", async () => {
  const initial = envelope();
  const accepted = await services.publish(organization.context, initial);
  const id = accepted.result.sessionId;
  const end = {
    ...initial,
    batchId: randomUUID(),
    records: [],
    behavior: "end",
    start: null,
    sentAt: "2026-09-02T00:00:00Z",
  };
  await services.publish(organization.context, end);
  const resume = {
    ...initial,
    batchId: randomUUID(),
    records: [],
    start: { resume: true },
    sentAt: "2026-09-05T00:00:00Z",
  };
  expect(
    (await services.publish(organization.context, resume)).result,
  ).toMatchObject({ sessionId: id, accepted: 0 });
  const first = await services.messages(organizationId, id);
  expect(first.map((row) => row.content)).toEqual([
    "Native message 0",
    "Native message 20",
    "Session resumed.",
  ]);
  expect(first[2]).toMatchObject({
    raw_record_id: null,
    ingest_batch_id: resume.batchId,
    role: "SYSTEM",
    kind: "META",
    searchable: false,
    search_text: "",
  });
  expect(
    await database.prisma.traceSessionControl.findUnique({
      where: { organizationId_id: { organizationId, id } },
    }),
  ).toMatchObject({
    status: "ACTIVE",
    parentSessionId: null,
    parentNativeRef: null,
    parentRelation: null,
  });
  await services.publish(organization.context, resume);
  await services.publish(organization.context, {
    ...end,
    batchId: randomUUID(),
  });
  await services.publish(organization.context, {
    ...initial,
    batchId: randomUUID(),
    behavior: "sync",
    start: null,
    records: [record(10)],
    sourcePos: 10,
    sentAt: "2026-09-01T01:00:00Z",
  });
  const second = await services.messages(organizationId, id);
  expect(second.map((row) => row.content)).toEqual([
    "Native message 0",
    "Native message 10",
    "Native message 20",
    "Session resumed.",
  ]);
  expect(second[3]?.id).toBe(first[2]?.id);
  expect(second[0]?.id).toBe(first[0]?.id);
  expect(
    await database.prisma.traceSourceAdmission.count({
      where: { sessionId: id },
    }),
  ).toBe(3);
  const runId = await services.prisma.$transaction((tx) =>
    services.jobs.rescan(tx, organization.owner, {
      reason: "Rebuild lifecycle provenance",
    }),
  );
  await services.jobs.start();
  await expect
    .poll(
      async () =>
        (
          await services.prisma.redactionRun.findUniqueOrThrow({
            where: { organizationId_id: { organizationId, id: runId } },
          })
        ).state,
      { timeout: 60_000, interval: 100 },
    )
    .toBe("completed");
  expect(
    (await services.messages(organizationId, id)).map((row) => row.id),
  ).toEqual(second.map((row) => row.id));
  const visible = await database.traceReaders.read(
    requireCaller(organization.context),
    (client) =>
      client.query(
        "SELECT raw_record_id,ingest_batch_id FROM messages WHERE message_id={id:UUID}",
        { id: first[2]?.id ?? "" },
      ),
  );
  expect(visible.rows).toEqual([
    { raw_record_id: null, ingest_batch_id: resume.batchId },
  ]);
});

it("does not infer resume markers from startup or unknown starts and orders multiple same-watermark resumes by source time", async () => {
  const initial = envelope();
  initial.records = [];
  const id = (await services.publish(organization.context, initial)).result
    .sessionId;
  await services.publish(organization.context, {
    ...initial,
    batchId: randomUUID(),
    sentAt: "2026-09-02T00:00:00Z",
  });
  await services.publish(organization.context, {
    ...initial,
    batchId: randomUUID(),
    start: null,
    sentAt: "2026-09-03T00:00:00Z",
  });
  expect((await services.messages(organizationId, id)).length).toBe(0);
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
  await services.publish(organization.context, late);
  await services.publish(organization.context, early);
  expect(
    (await services.messages(organizationId, id)).map(
      (row) => row.ingest_batch_id,
    ),
  ).toEqual([early.batchId, late.batchId]);
});

// @req R-ING-07 @req R-ORG-01
it("publishes exactly one scoped raw or META receipt source even when organizations share native and batch identities", async () => {
  const initial = envelope();
  const local = await services.publish(organization.context, initial);
  const foreign = await services.publish(other.context, initial);
  const resume = {
    ...initial,
    batchId: randomUUID(),
    records: [],
    start: { resume: true },
    sentAt: "2026-09-06T00:00:00Z",
  };
  await services.publish(organization.context, resume);
  await services.publish(other.context, resume);
  expect(local.result.sessionId).not.toBe(foreign.result.sessionId);
  const identities = new Set<string>();
  for (const [org, accepted] of [
    [organization, local],
    [other, foreign],
  ] as const) {
    const orgId = requireCaller(org.context).organizationId;
    const current = await services.scope(orgId, accepted.result.sessionId);
    const raw = await database.traces.rawPage(current, {
      after: null,
      limit: 1000,
    });
    const rawIds = new Set(raw.records.map((row) => row.id));
    const receipts = await services.prisma.traceReceipt.findMany({
      where: { organizationId: orgId, sessionId: accepted.result.sessionId },
    });
    const receiptIds = new Set(receipts.map((row) => row.id));
    const messages = await services.messages(orgId, accepted.result.sessionId);
    expect(messages).toHaveLength(3);
    for (const row of messages) {
      expect(identities.has(row.id)).toBe(false);
      identities.add(row.id);
      expect(
        Number(row.raw_record_id !== null) +
          Number(row.ingest_batch_id !== null),
      ).toBe(1);
      if (row.raw_record_id !== null)
        expect(rawIds.has(row.raw_record_id)).toBe(true);
      else {
        expect(receiptIds.has(row.ingest_batch_id ?? "")).toBe(true);
        expect(row).toMatchObject({
          role: "SYSTEM",
          kind: "META",
          searchable: false,
        });
      }
    }
    const visible = await database.traceReaders.read(
      requireCaller(org.context),
      (client) =>
        client.query(
          "SELECT DISTINCT session_id FROM messages WHERE session_id IN ({local:UUID},{foreign:UUID})",
          { local: local.result.sessionId, foreign: foreign.result.sessionId },
        ),
    );
    expect(visible.rows).toEqual([{ session_id: accepted.result.sessionId }]);
  }
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
  const id = (await services.publish(organization.context, initial)).result
    .sessionId;
  const pending = {
    ...initial,
    batchId: randomUUID(),
    records: [],
    start: { resume: true },
    sentAt: "2026-09-04T00:00:00Z",
    context: { ...initial.context, activeLeafId: "not-arrived" },
  };
  const accepted = await services.ingest.execute(organization.context, pending);
  expect(accepted.result.publication).toBe("queued");
  await services.projection.process(organizationId, id);
  await expect
    .poll(
      async () =>
        (
          await database.prisma.traceSessionControl.findUniqueOrThrow({
            where: { organizationId_id: { organizationId, id } },
          })
        ).projectionState,
    )
    .toBe("waiting_source");
  expect(
    (await services.messages(organizationId, id)).map((row) => row.content),
  ).toEqual(["Visible prior branch", "Session resumed."]);
  expect(
    await database.prisma.traceSessionControl.findUnique({
      where: { organizationId_id: { organizationId, id } },
    }),
  ).toMatchObject({
    normalizerContext: { activeLeafId: "not-arrived" },
    projectedContext: { activeLeafId: "a" },
  });
});

// @req R-DASH-17 @req R-ING-07
it("uses the published native start for reuse windows after an end arrives before its start and resume", async () => {
  const initial = envelope();
  initial.behavior = "end";
  initial.start = null;
  initial.nativeEvent = "SessionEnd";
  initial.sentAt = "2026-09-01T10:00:00Z";
  initial.records = [
    {
      ...record(0),
      line: JSON.stringify({
        type: "user",
        uuid: "historical-native-start",
        timestamp: "2026-09-01T09:00:00Z",
        message: { content: "A delayed native transcript" },
      }),
    },
  ];
  const id = (await services.ingest.execute(organization.context, initial))
    .result.sessionId;
  const control = await database.prisma.traceSessionControl.findUniqueOrThrow({
    where: { organizationId_id: { organizationId, id } },
  });
  expect(control.startedAt.getTime()).toBeGreaterThan(
    new Date(initial.sentAt).getTime(),
  );
  await services.projection.process(organizationId, id);
  expect(
    (
      await database.prisma.traceSessionControl.findUniqueOrThrow({
        where: { organizationId_id: { organizationId, id } },
      })
    ).startedAt,
  ).toEqual(new Date("2026-09-01T09:00:00Z"));
  expect(
    (
      await database.prisma.traceReceipt.findUniqueOrThrow({
        where: { organizationId_id: { organizationId, id: initial.batchId } },
      })
    ).receivedAt,
  ).toEqual(control.startedAt);
  expect((await services.header(organizationId, id)).started_at).toEqual(
    new Date("2026-09-01T09:00:00Z"),
  );
  await services.publish(organization.context, {
    ...initial,
    batchId: randomUUID(),
    records: [],
    behavior: "start",
    start: { resume: false },
    nativeEvent: "SessionStart",
    sourcePos: 0,
    sentAt: "2026-09-01T09:00:00Z",
  });
  await services.publish(organization.context, {
    ...initial,
    batchId: randomUUID(),
    records: [],
    behavior: "start",
    start: { resume: true },
    nativeEvent: "SessionStart",
    sourcePos: 30,
    sentAt: "2026-09-01T12:00:00Z",
  });
  await services.publish(organization.context, {
    ...initial,
    batchId: randomUUID(),
    records: [],
    sourcePos: 40,
    sentAt: "2026-09-01T13:00:00Z",
  });
  const windows = await database.traceReaders.read(
    requireCaller(organization.context),
    async (client) =>
      z
        .array(
          z.object({
            active_from: z.coerce.date(),
            active_to: z.coerce.date(),
          }),
        )
        .parse(
          (
            await client.query(
              "SELECT active_from,active_to FROM api_ro.metrics_active_windows WHERE session_id={id:UUID}",
              { id },
            )
          ).rows,
        ),
  );
  const active = (time: string) =>
    windows.some(
      (window) =>
        window.active_from <= new Date(time) &&
        window.active_to > new Date(time),
    );
  expect(active("2026-09-01T09:30:00Z")).toBe(true);
  expect(active("2026-09-01T10:00:00Z")).toBe(false);
  expect(active("2026-09-01T11:00:00Z")).toBe(false);
  expect(active("2026-09-01T12:00:00Z")).toBe(true);
  expect(active("2026-09-01T13:00:00Z")).toBe(false);
  expect(
    windows.every((window) => window.active_to >= window.active_from),
  ).toBe(true);
});

// @req R-LNK-06
it("paginates historical native tree timestamps without repeated or skipped nodes", async () => {
  const root = envelope();
  const capture = async (body: typeof root, hour: number) => {
    body.records = [
      {
        ...record(0),
        line: JSON.stringify({
          type: "user",
          uuid: randomUUID(),
          timestamp: `2026-09-01T${String(hour).padStart(2, "0")}:00:00Z`,
          message: { content: "Historical tree node" },
        }),
      },
    ];
    return (await services.publish(organization.context, body)).result
      .sessionId;
  };
  const parent = await capture(root, 9);
  const child = () => {
    const body = envelope();
    body.context.parentHint = {
      relation: "SPAWNED",
      harnessSessionId: root.harnessSessionId,
    };
    return body;
  };
  const later = await capture(child(), 11);
  const earlier = await capture(child(), 10);
  const reader = new SessionService({
    prisma: database.prisma,
    readers: database.traceReaders,
    audit: database.audit,
    cursors: new CursorCodec("historical-native-tree-review"),
  });
  const ids: string[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 4; page++) {
    const result: Awaited<ReturnType<SessionService["tree"]>>["result"] = (
      await reader.tree(organization.context, parent, { limit: 1, cursor })
    ).result;
    for (const node of result.nodes) {
      expect(ids).not.toContain(node.session_id);
      ids.push(node.session_id);
    }
    cursor = result.cursor;
    if (!cursor) break;
  }
  expect(cursor).toBeNull();
  expect(ids).toEqual([parent, earlier, later]);
});
