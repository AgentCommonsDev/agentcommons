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
