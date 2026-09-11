import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { startTraceDatabase } from "../../../packages/traces/test/support.js";
import { traceServices, waitForJob } from "./trace-services.js";
import { provisionOrganization, releaser } from "./support.js";
import { testEnvelope, textRecord } from "./envelopes.js";
import { requireCaller } from "../src/services/context.js";
import { createPolicyCache } from "../src/services/policy-cache.js";
import { AdminService } from "../src/services/admin.js";
import { PolicyService } from "../src/services/policies.js";
import { CursorCodec } from "../src/services/cursor.js";
import { RESCAN_CONCURRENCY } from "../src/services/trace-rescan.js";

let database: Awaited<ReturnType<typeof startTraceDatabase>>;
let organization: Awaited<ReturnType<typeof provisionOrganization>>;
let other: Awaited<ReturnType<typeof provisionOrganization>>;
let organizationId: string;
let services: ReturnType<typeof traceServices>;
let admin: AdminService;
let policies: PolicyService;
const { defer, release } = releaser();

beforeAll(async () => {
  database = await startTraceDatabase();
  defer(() => database.close());
  organization = await provisionOrganization(database, "engine-cache");
  other = await provisionOrganization(database, "engine-cache-other");
  organizationId = requireCaller(organization.context).organizationId;
  services = traceServices(database);
  defer(() => services.close());
  const cursors = new CursorCodec("engine-cache-cursor-secret");
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

/** One published session whose first prompt carries `text`; returns its id. */
async function publish(
  context: Parameters<typeof services.publish>[0],
  text: string,
): Promise<string> {
  const accepted = await services.publish(
    context,
    testEnvelope({
      harnessSessionId: randomUUID(),
      installationId: randomUUID(),
      records: [textRecord(0, text, { uuid: randomUUID() })],
    }),
  );
  return accepted.result.sessionId;
}

// @req R-RED-02
it("reuses one compiled engine across transactions per organization and recompiles the moment a policy row changes", async () => {
  const otherId = requireCaller(other.context).organizationId;
  // Two transaction-bound caches (as two accepts would create) share the engine, and the
  // organizations never share one even when their rows compose alike.
  const first = await createPolicyCache(database.prisma).get(organizationId);
  expect(await createPolicyCache(database.prisma).get(organizationId)).toBe(
    first,
  );
  const foreign = await createPolicyCache(database.prisma).get(otherId);
  expect(foreign).not.toBe(first);
  expect(await createPolicyCache(database.prisma).get(otherId)).toBe(foreign);

  const before = await publish(organization.context, "engine-phrase before");
  expect((await services.header(organizationId, before)).title).toContain(
    "engine-phrase",
  );
  const saved = await policies.save(organization.owner, null, {
    name: "engine",
    kind: "REGEX",
    pattern: "engine-phrase",
    flags: "g",
    enabled: true,
  });
  // The saved row changes the fingerprint: the next transaction compiles a new engine and
  // the next accept redacts with it, in this same process, with no restart or expiry.
  const changed = await createPolicyCache(database.prisma).get(organizationId);
  expect(changed).not.toBe(first);
  expect(await createPolicyCache(database.prisma).get(organizationId)).toBe(
    changed,
  );
  const after = await publish(organization.context, "engine-phrase after");
  expect((await services.header(organizationId, after)).title).toBe(
    "[REDACTED:engine] after",
  );
  // The other organization keeps its own engine and rules.
  const elsewhere = await publish(other.context, "engine-phrase elsewhere");
  expect((await services.header(otherId, elsewhere)).title).toBe(
    "engine-phrase elsewhere",
  );
  expect(await createPolicyCache(database.prisma).get(otherId)).toBe(foreign);

  // Removing the row selects yet another engine; the rows the transaction sees decide.
  await policies.remove(organization.owner, saved.result.id, {
    reason: "Engine cache test",
  });
  const removed = await createPolicyCache(database.prisma).get(organizationId);
  expect(removed).not.toBe(changed);
  const later = await publish(organization.context, "engine-phrase later");
  expect((await services.header(organizationId, later)).title).toBe(
    "engine-phrase later",
  );
});

// @req R-RED-06 @req R-RED-02
it("applies a policy saved after ingest to every earlier session through a rescan that publishes bounded batches", async () => {
  // Its own organization: the rescan covers every session the organization holds.
  const organization = await provisionOrganization(
    database,
    "engine-cache-rescan",
  );
  const organizationId = requireCaller(organization.context).organizationId;
  const total = RESCAN_CONCURRENCY * 2 + 1;
  const sessions: string[] = [];
  for (let index = 0; index < total; index++)
    sessions.push(
      await publish(
        organization.context,
        `batch-phrase session ${String(index)}`,
      ),
    );
  const saved = await policies.save(organization.owner, null, {
    name: "batch",
    kind: "REGEX",
    pattern: "batch-phrase",
    flags: "g",
    enabled: true,
  });
  const run = await admin.rescan(organization.owner, {
    reason: "Engine cache rescan",
    policyIds: [saved.result.id],
  });
  const progress = await waitForJob(
    services.jobs,
    organization.owner,
    run.result.job_id,
    "completed",
    60_000,
  );
  expect(progress).toMatchObject({
    total_sessions: total,
    processed_sessions: total,
  });
  expect(progress.redaction_count).toBeGreaterThanOrEqual(total);
  for (const [index, sessionId] of sessions.entries())
    expect((await services.header(organizationId, sessionId)).title).toBe(
      `[REDACTED:batch] session ${String(index)}`,
    );
  // One successful session audit per target, and the run advanced in batches of at
  // most RESCAN_CONCURRENCY targets rather than one job per session.
  for (const sessionId of sessions)
    expect(
      await database.prisma.auditEvent.count({
        where: {
          organizationId,
          action: "redaction.rescan.session",
          resourceIds: { has: sessionId },
          statusCode: 200,
        },
      }),
    ).toBe(1);
  const advances = await database.prisma.auditEvent.findMany({
    where: {
      organizationId,
      action: "redaction.rescan.advance",
      resourceIds: { has: run.result.job_id },
    },
  });
  const batches = advances.map((row) =>
    row.detail &&
    typeof row.detail === "object" &&
    "batch_sessions" in row.detail
      ? Number(row.detail.batch_sessions)
      : 0,
  );
  expect(batches.reduce((sum, size) => sum + size, 0)).toBe(total);
  expect(Math.max(...batches)).toBe(RESCAN_CONCURRENCY);
  expect(advances.length).toBe(Math.ceil(total / RESCAN_CONCURRENCY));

  // Removing the policy changes the engine for new accepts; redacted text never returns.
  await policies.remove(organization.owner, saved.result.id, {
    reason: "Engine cache rescan test",
  });
  const fresh = await publish(organization.context, "batch-phrase fresh");
  expect((await services.header(organizationId, fresh)).title).toBe(
    "batch-phrase fresh",
  );
  expect((await services.header(organizationId, sessions[0] ?? "")).title).toBe(
    "[REDACTED:batch] session 0",
  );
  expect(services.errors).toEqual([]);
});

// @req R-RED-06
it("checkpoints every session of a rescan that changes nothing without rebuilding it, then rebuilds only the sessions a later policy changes", async () => {
  const organization = await provisionOrganization(
    database,
    "engine-cache-noop",
  );
  const organizationId = requireCaller(organization.context).organizationId;
  const sessions: string[] = [];
  for (let index = 0; index < 4; index++)
    sessions.push(
      await publish(
        organization.context,
        index % 2
          ? `noop-phrase session ${String(index)}`
          : `plain session ${String(index)}`,
      ),
    );
  const before = new Map(
    (
      await database.prisma.traceSessionControl.findMany({
        where: { organizationId, id: { in: sessions } },
      })
    ).map((row) => [row.id, row]),
  );
  await policies.save(organization.owner, null, {
    name: "never",
    kind: "REGEX",
    pattern: "zzz-never-matches-[0-9]{40}",
    flags: "g",
    enabled: true,
  });
  const noop = await admin.rescan(organization.owner, {
    reason: "Nothing to redact",
  });
  const progress = await waitForJob(
    services.jobs,
    organization.owner,
    noop.result.job_id,
    "completed",
    60_000,
  );
  expect(progress).toMatchObject({
    total_sessions: 4,
    processed_sessions: 4,
    redaction_count: 0,
  });
  for (const [index, sessionId] of sessions.entries()) {
    const previous = before.get(sessionId);
    const current = await database.prisma.traceSessionControl.findUniqueOrThrow(
      { where: { organizationId_id: { organizationId, id: sessionId } } },
    );
    // Published at the claimed revision, same generation: no sink write happened.
    expect(current.redactionGeneration).toBe(previous?.redactionGeneration);
    expect(current.publishedRevision).toBe(current.acceptedRevision);
    expect(current.publishedRevision).toBe(
      (previous?.publishedRevision ?? 0n) + 1n,
    );
    expect(current.projectionState).toBe("published");
    expect(current.projectionLease).toBeNull();
    expect((await services.header(organizationId, sessionId)).title).toBe(
      index % 2
        ? `noop-phrase session ${String(index)}`
        : `plain session ${String(index)}`,
    );
    const audits = await database.prisma.auditEvent.findMany({
      where: {
        organizationId,
        action: "redaction.rescan.session",
        resourceIds: { has: sessionId },
        statusCode: 200,
      },
    });
    expect(audits.map((row) => row.detail)).toEqual([
      expect.objectContaining({
        run_id: noop.result.job_id,
        unchanged: true,
        changed_messages: 0,
        changed_files: 0,
      }),
    ]);
  }
  expect(
    await database.prisma.traceOutbox.count({
      where: { organizationId, sessionId: { in: sessions } },
    }),
  ).toBe(0);

  // A policy that matches half the sessions rebuilds exactly those.
  await policies.save(organization.owner, null, {
    name: "noop",
    kind: "REGEX",
    pattern: "noop-phrase",
    flags: "g",
    enabled: true,
  });
  const mixed = await admin.rescan(organization.owner, {
    reason: "Half the sessions change",
  });
  await waitForJob(
    services.jobs,
    organization.owner,
    mixed.result.job_id,
    "completed",
    60_000,
  );
  for (const [index, sessionId] of sessions.entries()) {
    const current = await database.prisma.traceSessionControl.findUniqueOrThrow(
      { where: { organizationId_id: { organizationId, id: sessionId } } },
    );
    const audit = await database.prisma.auditEvent.findFirstOrThrow({
      where: {
        organizationId,
        action: "redaction.rescan.session",
        resourceIds: { has: sessionId },
        statusCode: 200,
        detail: { path: ["run_id"], equals: mixed.result.job_id },
      },
    });
    if (index % 2) {
      expect(current.redactionGeneration).toBe(current.publishedRevision);
      expect(audit.detail).not.toMatchObject({ unchanged: true });
      expect((await services.header(organizationId, sessionId)).title).toBe(
        `[REDACTED:noop] session ${String(index)}`,
      );
    } else {
      expect(current.redactionGeneration).toBe(
        before.get(sessionId)?.redactionGeneration,
      );
      expect(audit.detail).toMatchObject({ unchanged: true });
    }
  }
  expect(services.errors).toEqual([]);
});
