import { startTraceDatabase } from "../../../packages/traces/test/support.js";
import { afterAll, beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { memberSchema, membersOutputSchema } from "@agentcommons/core/schemas";
import { MembershipService } from "../src/services/membership.js";
import type { ServiceError, ServiceContext } from "../src/services/context.js";
import { provisionMember, provisionOrganization, releaser } from "./support.js";

let db: Awaited<ReturnType<typeof startTraceDatabase>>;
let organization: Awaited<ReturnType<typeof provisionOrganization>>;
let other: Awaited<ReturnType<typeof provisionOrganization>>;
let active: Awaited<ReturnType<typeof provisionMember>>;
let quiet: Awaited<ReturnType<typeof provisionMember>>;
let members: MembershipService;
const { defer, release } = releaser();

const userOf = (context: ServiceContext) =>
  z.string().parse(context.caller?.userId);
const organizationOf = (context: ServiceContext) =>
  z.string().parse(context.caller?.organizationId);
/** The organization's members as the owner lists them, parsed with the shared schema. */
async function listed(
  input: Parameters<MembershipService["list"]>[1] = {},
): Promise<z.infer<typeof memberSchema>[]> {
  const { result } = await members.list(organization.owner, input);
  return membersOutputSchema.parse(result).items;
}
const rowOf = (rows: z.infer<typeof memberSchema>[], context: ServiceContext) =>
  z
    .object({ last_seen_at: z.string().nullable() })
    .parse(rows.find((row) => row.user_id === userOf(context)));
/** One audit row as the API writes it for a request, at an explicit instant. */
function auditRow(
  context: ServiceContext,
  ts: Date,
  overrides: { organizationId?: string; authMethod?: string } = {},
) {
  return {
    id: randomUUID(),
    organizationId: overrides.organizationId ?? organizationOf(context),
    ts,
    requestId: randomUUID(),
    userId: userOf(context),
    apiKeyId: null,
    authMethod: overrides.authMethod ?? "cookie",
    ip: "127.0.0.1",
    transport: "rest",
    action: "sessions.list",
    statusCode: 200,
    durationMs: 3,
    detail: {},
  };
}

beforeAll(async () => {
  db = await startTraceDatabase();
  defer(() => db.close());
  organization = await provisionOrganization(db, "members-primary");
  other = await provisionOrganization(db, "members-other");
  members = new MembershipService(db.prisma, db.authConfiguration, db.audit);
  active = await provisionMember(db, organization.owner, "active@example.com");
  quiet = await provisionMember(db, organization.owner, "quiet@example.com");
  // Provisioning signed both members in once; only the events below should decide.
  await db.prisma.auditEvent.deleteMany({
    where: { userId: { in: [userOf(active.owner), userOf(quiet.owner)] } },
  });
}, 120_000);
afterAll(release);

// @req R-ORG-12 @req R-AUD-01
it("derives last_seen_at from the member's newest cookie request in this organization and sorts by it", async () => {
  const seen = new Date("2026-09-10T08:00:00Z");
  const later = new Date("2026-09-11T09:30:00Z");
  await db.prisma.auditEvent.createMany({
    data: [
      // The dashboard visit that counts.
      auditRow(active.owner, seen),
      // Newer, but made with an API key (a hook upload or an agent read): not a visit.
      auditRow(active.owner, later, { authMethod: "key" }),
      // Newer, but in another organization the same account belongs to.
      auditRow(active.owner, later, {
        organizationId: organizationOf(other.owner),
      }),
    ],
  });
  const rows = await listed();
  expect(rowOf(rows, active.owner).last_seen_at).toBe(seen.toISOString());
  expect(rowOf(rows, quiet.owner).last_seen_at).toBeNull();
  // The owner's own list request is a cookie read, so their row is at most seconds old.
  const owner = rowOf(rows, organization.owner).last_seen_at;
  expect(owner).not.toBeNull();
  expect(Date.now() - Date.parse(z.string().parse(owner))).toBeLessThan(60_000);

  const newestFirst = await listed({ sort: "last_seen_at", order: "desc" });
  expect(newestFirst.map((row) => row.user_id).slice(0, 2)).toEqual([
    userOf(organization.owner),
    userOf(active.owner),
  ]);
  expect(newestFirst.at(-1)?.user_id).toBe(userOf(quiet.owner));
  const oldestFirst = await listed({ sort: "last_seen_at", order: "asc" });
  // Members who never visited sort last either way; the visited ones flip.
  expect(oldestFirst.map((row) => row.user_id)).toEqual([
    userOf(active.owner),
    userOf(organization.owner),
    userOf(quiet.owner),
  ]);
  // The email filter still narrows and carries the same derived field.
  expect(
    (await listed({ filters: { email: "active@example.com" } })).map(
      (row) => row.last_seen_at,
    ),
  ).toEqual([seen.toISOString()]);
});

// @req R-ORG-12 @req R-ORG-08
it("reads one member by membership id with the same fields, inside the caller's organization and for admins only", async () => {
  const rows = await listed();
  const target = rows.find((row) => row.user_id === userOf(active.owner));
  if (!target) throw new Error("Expected the active member in the list.");
  const { result } = await members.get(organization.owner, target.id);
  expect(memberSchema.parse(result)).toEqual(target);
  const row = await db.prisma.auditEvent.findFirst({
    where: { action: "members.get", resourceIds: { has: target.id } },
  });
  expect(row?.organizationId).toBe(organizationOf(organization.owner));

  await expect(members.get(other.owner, target.id)).rejects.toMatchObject({
    statusCode: 404,
    code: "NOT_FOUND",
  } satisfies Partial<ServiceError>);
  await expect(members.get(active.owner, target.id)).rejects.toMatchObject({
    statusCode: 403,
  });
  await expect(
    members.get(organization.owner, `missing-${randomUUID()}`),
  ).rejects.toMatchObject({ statusCode: 404 });
});

// @req R-ORG-12
it("answers last_seen_at in one statement whose cost does not grow with the member's key traffic", async () => {
  // 60,000 key-authenticated events (hook uploads, agent reads) newer than the visit, the
  // shape that would make a newest-first scan of a per-user index walk thousands of rows.
  const visit = new Date("2026-09-01T00:00:00Z");
  await db.prisma.auditEvent.create({ data: auditRow(quiet.owner, visit) });
  const start = Date.parse("2026-09-02T00:00:00Z");
  for (let batch = 0; batch < 12; batch++)
    await db.prisma.auditEvent.createMany({
      data: Array.from({ length: 5000 }, (_, index) => ({
        ...auditRow(
          quiet.owner,
          new Date(start + (batch * 5000 + index) * 1000),
          {
            authMethod: "key",
          },
        ),
        action: "ingest",
      })),
    });
  await db.prisma.$executeRawUnsafe("ANALYZE audit_event");
  const timings: number[] = [];
  for (const sort of ["created_at", "last_seen_at", "email"] as const) {
    const began = performance.now();
    const rows = await listed({ sort, order: "desc" });
    timings.push(performance.now() - began);
    expect(rowOf(rows, quiet.owner).last_seen_at).toBe(visit.toISOString());
  }
  const plan = z
    .array(z.object({ "QUERY PLAN": z.string() }))
    .parse(
      await db.prisma.$queryRawUnsafe(
        `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) SELECT (SELECT a.ts FROM audit_event a WHERE a.organization_id=m."organizationId" AND a.auth_method='cookie' AND a.user_id=m."userId" ORDER BY a.ts DESC LIMIT 1) FROM member m WHERE m."organizationId"=$1 AND m."removedAt" IS NULL`,
        organizationOf(organization.owner),
      ),
    )
    .map((line) => line["QUERY PLAN"])
    .join("\n");
  console.info(
    `members list with 60k key events: ${timings.map((value) => value.toFixed(1)).join(" / ")} ms (created_at / last_seen_at / email)\n${plan}`,
  );
  // The probe walks the composite index, never the member's 60,000 key rows.
  expect(plan).toContain(
    "audit_event_organization_id_auth_method_user_id_ts_idx",
  );
  expect(Math.max(...timings)).toBeLessThan(2000);
}, 120_000);
