import { afterAll, beforeAll, expect, it } from "vitest";
import { cleanup } from "../../../scripts/cleanup.js";
import {
  provisionMember,
  provisionOrganization,
  startDatabase,
  testAuthConfiguration,
} from "./support.js";
import { requireCaller } from "../src/services/context.js";
let db: Awaited<ReturnType<typeof startDatabase>>;
const release: Array<() => Promise<unknown>> = [];
beforeAll(async () => {
  db = await startDatabase();
  release.push(() => db.close());
});
afterAll(async () => {
  expect(await cleanup(release)).toEqual([]);
});
it("rejects native organization deletion before removing any memberships or organization data", async () => {
  const org = await provisionOrganization(db, "organization-delete-disabled");
  await provisionMember(db, org.owner, "delete-member@example.test");
  const caller = requireCaller(org.owner);
  const before = await db.prisma.member.findMany({
    where: { organizationId: caller.organizationId },
    orderBy: { id: "asc" },
  });
  const headers = new Headers(org.owner.headers);
  headers.set("content-type", "application/json");
  headers.set("origin", testAuthConfiguration.publicUrl);
  const response = await db.auth.native.handler(
    new Request(`${testAuthConfiguration.publicUrl}/auth/organization/delete`, {
      method: "POST",
      headers,
      body: JSON.stringify({ organizationId: caller.organizationId }),
    }),
  );
  expect(response.status).toBe(404);
  expect(await response.json()).toMatchObject({
    code: "ORGANIZATION_DELETION_DISABLED",
  });
  expect(
    await db.prisma.member.findMany({
      where: { organizationId: caller.organizationId },
      orderBy: { id: "asc" },
    }),
  ).toEqual(before);
  expect(
    await db.prisma.organization.count({
      where: { id: caller.organizationId },
    }),
  ).toBe(1);
});
