import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { startTraceDatabase } from "../../../packages/traces/test/support.js";
import { traceServices, waitForJob } from "./trace-services.js";
import { provisionMember, provisionOrganization, releaser } from "./support.js";
import { testEnvelope, textRecord } from "./envelopes.js";
import { requireCaller } from "../src/services/context.js";
import { AdminService } from "../src/services/admin.js";
import { PolicyService } from "../src/services/policies.js";
import { CursorCodec } from "../src/services/cursor.js";

let database: Awaited<ReturnType<typeof startTraceDatabase>>;
let organization: Awaited<ReturnType<typeof provisionOrganization>>;
let member: Awaited<ReturnType<typeof provisionMember>>;
let organizationId: string;
let services: ReturnType<typeof traceServices>;
let admin: AdminService;
let policies: PolicyService;
const { defer, release } = releaser();

beforeAll(async () => {
  database = await startTraceDatabase();
  defer(() => database.close());
  organization = await provisionOrganization(database, "redaction-ledger");
  member = await provisionMember(
    database,
    organization.owner,
    "ledger-member@example.com",
  );
  organizationId = requireCaller(organization.context).organizationId;
  services = traceServices(database);
  defer(() => services.close());
  const cursors = new CursorCodec("redaction-ledger-cursor-secret");
  admin = new AdminService({
    ...database,
    readers: database.traceReaders,
    cursors,
    jobs: services.jobs,
    server: { version: "test-release", autoUpdate: false },
  });
  policies = new PolicyService({
    ...database,
    cursors,
    cache: database.policies,
  });
  await services.jobs.start();
});
afterAll(release);

/** One published session with the given message texts, in order; returns its id and batch id. */
async function publish(texts: readonly string[]) {
  const batchId = randomUUID();
  const accepted = await services.publish(
    organization.context,
    testEnvelope({
      batchId,
      harnessSessionId: randomUUID(),
      installationId: randomUUID(),
      records: texts.map((text, index) =>
        textRecord(index, text, { uuid: randomUUID() }),
      ),
    }),
  );
  return { sessionId: accepted.result.sessionId, batchId };
}
const hitsOf = (sessionId: string, runId: string | null = null) =>
  database.prisma.redactionHit.findMany({
    where: { organizationId, sessionId, runId },
    orderBy: [{ seq: "asc" }],
  });

// @req R-RED-09 @req R-RED-10
it("records where each capture-time redaction landed, per message, and reports totals, windows and per-policy counts to admins only", async () => {
  const saved = await policies.save(organization.owner, null, {
    name: "ledger",
    kind: "REGEX",
    pattern: "ledger-secret-[0-9]+",
    flags: "g",
    enabled: true,
  });
  const policyId = saved.result.id;
  const { sessionId, batchId } = await publish([
    "hello ledger-secret-1 world",
    "nothing to redact here",
    "ledger-secret-2 twice ledger-secret-3",
  ]);
  // The counter holds the batch total; the ledger says which messages, and how many each.
  const counter = await database.prisma.redactionEvent.findUnique({
    where: {
      ingestBatchId_sessionId_policyId: {
        ingestBatchId: batchId,
        sessionId,
        policyId,
      },
    },
  });
  expect(counter?.count).toBe(3);
  const hits = await hitsOf(sessionId);
  expect(
    hits.map((hit) => ({
      batch: hit.ingestBatchId,
      policy: hit.policyId,
      seq: hit.seq,
      count: hit.count,
      run: hit.runId,
    })),
  ).toEqual([
    { batch: batchId, policy: policyId, seq: 0, count: 1, run: null },
    { batch: batchId, policy: policyId, seq: 2, count: 2, run: null },
  ]);
  const messages = await services.messages(organizationId, sessionId);
  expect(messages[0]?.content).toBe("hello [REDACTED:ledger] world");
  expect(messages[2]?.content).toBe(
    "[REDACTED:ledger] twice [REDACTED:ledger]",
  );

  const summary = (await policies.summary(organization.owner)).result;
  expect(summary.total).toBe(3);
  expect(summary.sessions).toBe(1);
  expect(summary.last_7_days).toEqual({ capture: 3, rescan: 0, total: 3 });
  expect(summary.last_30_days).toEqual({ capture: 3, rescan: 0, total: 3 });
  expect(summary.by_policy).toContainEqual({
    policy_id: policyId,
    name: "ledger",
    kind: "REGEX",
    enabled: true,
    count: 3,
    sessions: 1,
  });
  expect(summary.runs).toEqual({ total: 0, active: 0, failed: 0 });

  const listed = (
    await policies.hits(organization.owner, {
      filters: { session_id: sessionId },
      sort: "seq",
      order: "asc",
    })
  ).result;
  expect(listed.cursor).toBeNull();
  expect(listed.items.map((hit) => [hit.seq, hit.count, hit.source])).toEqual([
    [0, 1, "capture"],
    [2, 2, "capture"],
  ]);
  expect(listed.items[0]).toMatchObject({
    session_id: sessionId,
    ingest_batch_id: batchId,
    run_id: null,
    policy_id: policyId,
    policy_name: "ledger",
  });
  expect(
    (await policies.hits(organization.owner, { filters: { source: "rescan" } }))
      .result.items,
  ).toEqual([]);

  // Members hold no admin right: every ledger read is refused and audited as such.
  for (const read of [
    () => policies.summary(member.owner),
    () => policies.hits(member.owner, {}),
    () => policies.runs(member.owner, {}),
    () => policies.runSessions(member.owner, randomUUID(), {}),
    () => policies.summary(member.context),
  ])
    await expect(read()).rejects.toMatchObject({ statusCode: 403 });
  expect(
    await database.prisma.auditEvent.count({
      where: {
        organizationId,
        action: { in: ["redaction.summary", "redaction.hits"] },
        statusCode: 403,
      },
    }),
  ).toBeGreaterThanOrEqual(3);
  const audited = await database.prisma.auditEvent.findFirst({
    where: { organizationId, action: "redaction.summary", statusCode: 200 },
  });
  expect(audited?.detail).toMatchObject({
    result: { total: 3, sessions: 1 },
  });

  // Deleting the policy removes its counters and, with them, its ledger rows.
  await policies.remove(organization.owner, policyId, {
    reason: "Ledger test cleanup",
  });
  expect(await hitsOf(sessionId)).toEqual([]);
  expect((await policies.summary(organization.owner)).result.total).toBe(0);
});

// @req R-RED-09 @req R-RED-10 @req R-RED-06
it("records a rescan's hits under its run with the session's count, lists the sessions the run changed and links each hit to its message", async () => {
  const untouched = await publish(["a plain session"]);
  const changed = await publish([
    "first rescan-secret-7 here",
    "second rescan-secret-8 and rescan-secret-9",
  ]);
  const saved = await policies.save(organization.owner, null, {
    name: "rescan",
    kind: "REGEX",
    pattern: "rescan-secret-[0-9]+",
    flags: "g",
    enabled: true,
  });
  const run = await admin.rescan(organization.owner, {
    reason: "Ledger rescan",
    policyIds: [saved.result.id],
  });
  const runId = run.result.job_id;
  const progress = await waitForJob(
    services.jobs,
    organization.owner,
    runId,
    "completed",
    60_000,
  );
  // Three record hits plus two on the stored header (title and first prompt carry the
  // first message's text), which a rescan re-redacts and counts on the last receipt.
  expect(progress.redaction_count).toBe(5);

  // The run covers every session of the organization, the first test's included.
  const targets = await database.prisma.redactionRunSession.findMany({
    where: { organizationId, runId },
    orderBy: { sessionId: "asc" },
  });
  const counts = new Map(
    targets.map((row) => [row.sessionId, row.redactionCount]),
  );
  expect(counts.get(untouched.sessionId)).toBe(0);
  expect(counts.get(changed.sessionId)).toBe(5);
  expect([...counts.values()].reduce((sum, count) => sum + count, 0)).toBe(5);
  expect(targets.every((row) => row.processedAt !== null)).toBe(true);
  const hits = await hitsOf(changed.sessionId, runId);
  // Header hits have no message: they sit at a null position under the same receipt.
  expect(hits.map((hit) => [hit.seq, hit.count, hit.ingestBatchId])).toEqual([
    [0, 1, changed.batchId],
    [1, 2, changed.batchId],
    [null, 2, changed.batchId],
  ]);
  expect(await hitsOf(untouched.sessionId, runId)).toEqual([]);

  const runs = (await policies.runs(organization.owner, {})).result;
  expect(runs.items[0]).toMatchObject({
    id: runId,
    state: "completed",
    total_sessions: targets.length,
    processed_sessions: targets.length,
    changed_sessions: 1,
    redaction_count: 5,
    error: null,
  });
  const sessions = (await policies.runSessions(organization.owner, runId, {}))
    .result;
  expect(
    sessions.items.map((row) => [row.session_id, row.redaction_count]),
  ).toEqual([[changed.sessionId, 5]]);
  const every = (
    await policies.runSessions(organization.owner, runId, {
      filters: { changed: false },
    })
  ).result;
  expect(every.items.map((row) => row.session_id).sort()).toEqual(
    targets.map((row) => row.sessionId).sort(),
  );
  await expect(
    policies.runSessions(organization.owner, randomUUID(), {}),
  ).rejects.toMatchObject({ statusCode: 404 });
  const listed = (
    await policies.hits(organization.owner, {
      filters: { run_id: runId, session_id: changed.sessionId },
      sort: "seq",
      order: "asc",
    })
  ).result;
  expect(listed.items.map((hit) => [hit.seq, hit.count, hit.source])).toEqual([
    [0, 1, "rescan"],
    [1, 2, "rescan"],
    [null, 2, "rescan"],
  ]);
  // The linked messages are the redacted ones.
  const messages = await services.messages(organizationId, changed.sessionId);
  expect(messages[0]?.content).toBe("first [REDACTED:rescan] here");
  expect(messages[1]?.content).toBe(
    "second [REDACTED:rescan] and [REDACTED:rescan]",
  );
  const summary = (await policies.summary(organization.owner)).result;
  expect(summary.last_7_days.rescan).toBe(5);
  expect(summary.runs).toEqual({ total: 1, active: 0, failed: 0 });
  expect(services.errors).toEqual([]);
});
