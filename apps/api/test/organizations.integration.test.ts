import { startTraceDatabase } from "../../../packages/traces/test/support.js";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  cookieHeader,
  releaser,
  testAuthConfiguration,
  testAccountPassword,
  verifyEmail,
} from "./support.js";
import { startApp, type StartedApp } from "./app.js";
import { testEnvelope, textRecord } from "./envelopes.js";
import { AuthService } from "../src/services/auth.js";
import { operatorContext } from "../src/auth/bootstrap.js";
import {
  onboardingOutputSchema,
  keysOutputSchema,
  keyCreateOutputSchema,
} from "@agentcommons/core/schemas";

let db: Awaited<ReturnType<typeof startTraceDatabase>>;
let runtime: StartedApp["runtime"];
let app: StartedApp["app"];
const { defer, release } = releaser();
const origin = testAuthConfiguration.publicUrl;
async function identity(label: string) {
  const email = `${label}-${randomUUID()}@example.test`;
  const created = await db.auth.native.api.createUser({
    body: { email, name: `${label} owner`, password: testAccountPassword },
  });
  await verifyEmail(db, created.user.id);
  const signed = await db.auth.native.api.signInEmail({
    body: { email, password: testAccountPassword },
    asResponse: true,
  });
  const headers = { origin, cookie: cookieHeader(signed) };
  return { id: created.user.id, email, headers };
}
type Identity = Awaited<ReturnType<typeof identity>>;
async function create(
  user: Identity,
  slug: string,
  path = "/api/v1/me/organizations",
  name = slug,
) {
  return app.inject({
    method: "POST",
    url: path,
    headers: user.headers,
    payload: { name, slug },
  });
}
async function key(user: Identity, name: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/me/keys",
    headers: user.headers,
    payload: {
      name,
      permissions: { sessions: ["read", "ingest"], admin: ["*"] },
    },
  });
  expect(response.statusCode, response.body).toBe(200);
  return keyCreateOutputSchema.parse(response.json<unknown>());
}
beforeAll(async () => {
  db = await startTraceDatabase();
  defer(() => db.close());
  const started = await startApp(db, { INSTANCE_MODE: "saas" });
  defer(() => started.close());
  ({ runtime, app } = started);
});
afterAll(release);

// @req R-SAAS-01 @req R-AUD-01
it("keeps initial onboarding idempotent while explicit concurrent owned-slug retries create one additional native organization", async () => {
  const user = await identity("multiple");
  const initial = await create(user, "initial-multiple", "/api/v1/onboarding");
  expect(initial.statusCode, initial.body).toBe(200);
  const first = onboardingOutputSchema.parse(initial.json<unknown>());
  const secret = "sk-proj-" + "c".repeat(32);
  const attempts = await Promise.all(
    Array.from({ length: 4 }, () =>
      create(user, "additional-multiple", undefined, `Additional ${secret}`),
    ),
  );
  expect(attempts.map((result) => result.statusCode)).toEqual([
    200, 200, 200, 200,
  ]);
  const results = attempts.map((result) =>
    onboardingOutputSchema.parse(result.json<unknown>()),
  );
  expect(new Set(results.map((result) => result.organization_id)).size).toBe(1);
  expect(results.filter((result) => result.created)).toHaveLength(1);
  const extra = z.string().parse(results[0]?.organization_id);
  expect(extra).not.toBe(first.organization_id);
  expect(
    (await db.prisma.user.findUniqueOrThrow({ where: { id: user.id } }))
      .onboardingOrganizationId,
  ).toBe(first.organization_id);
  expect(
    await db.prisma.member.findFirst({
      where: { organizationId: extra, userId: user.id },
    }),
  ).toMatchObject({ role: "owner", suspended: false, removedAt: null });
  expect(
    await db.prisma.redactionPolicy.count({ where: { organizationId: extra } }),
  ).toBeGreaterThan(0);
  expect(
    (await db.prisma.organization.findUniqueOrThrow({ where: { id: extra } }))
      .name,
  ).not.toContain(secret);
  expect(
    await db.prisma.auditEvent.count({
      where: {
        action: "organizations.create",
        organizationId: extra,
        statusCode: 200,
      },
    }),
  ).toBe(4);
  const retried = await create(
    user,
    "additional-multiple",
    undefined,
    "Do not rename",
  );
  expect(onboardingOutputSchema.parse(retried.json<unknown>())).toEqual({
    organization_id: extra,
    created: false,
  });
  expect(
    (await db.prisma.organization.findUniqueOrThrow({ where: { id: extra } }))
      .name,
  ).not.toBe("Do not rename");
  const me = await app.inject({
    method: "GET",
    url: "/api/v1/me",
    headers: user.headers,
  });
  expect(me.json<unknown>()).toMatchObject({
    organization: { id: extra, role: "owner" },
  });
  const original = await create(
    user,
    "ignored-retry-name",
    "/api/v1/onboarding",
  );
  expect(onboardingOutputSchema.parse(original.json<unknown>())).toEqual({
    organization_id: first.organization_id,
    created: false,
  });
  expect(
    await db.prisma.organization.count({
      where: { slug: "ignored-retry-name" },
    }),
  ).toBe(0);
});

// @req R-SAAS-01 @req R-ORG-04
it("arbitrates simultaneous slug claims and never restores removed or suspended owner membership", async () => {
  const [left, right] = await Promise.all([
    identity("claim-left"),
    identity("claim-right"),
  ]);
  const results = await Promise.all([
    create(left, "shared-slug-claim"),
    create(right, "shared-slug-claim"),
  ]);
  expect(results.map((result) => result.statusCode).sort()).toEqual([200, 409]);
  const organization = await db.prisma.organization.findUniqueOrThrow({
    where: { slug: "shared-slug-claim" },
  });
  expect(
    await db.prisma.member.count({
      where: { organizationId: organization.id, role: "owner" },
    }),
  ).toBe(1);
  const winner = results[0].statusCode === 200 ? left : right;
  const member = await db.prisma.member.findFirstOrThrow({
    where: { organizationId: organization.id, userId: winner.id },
  });
  await db.prisma.member.update({
    where: { id: member.id },
    data: { suspended: true },
  });
  expect((await create(winner, "shared-slug-claim")).statusCode).toBe(409);
  await db.prisma.member.update({
    where: { id: member.id },
    data: { removedAt: new Date() },
  });
  expect((await create(winner, "shared-slug-claim")).statusCode).toBe(409);
  const retained = await db.prisma.member.findUniqueOrThrow({
    where: { id: member.id },
  });
  expect(retained.suspended).toBe(true);
  expect(retained.removedAt).toBeInstanceOf(Date);
});

// @req R-SAAS-01 @req R-AUD-01
it("rolls native organization, membership, active selection and policies back when the mutation audit fails", async () => {
  const user = await identity("rollback");
  const initial = onboardingOutputSchema.parse(
    (
      await create(user, "rollback-initial", "/api/v1/onboarding")
    ).json<unknown>(),
  );
  const original = runtime.services.audit.write.bind(runtime.services.audit);
  const spy = vi
    .spyOn(runtime.services.audit, "write")
    .mockImplementation(async (context, description, tx) => {
      if (description.action === "organizations.create" && tx)
        throw new Error("Forced organization audit storage failure");
      return original(context, description, tx);
    });
  try {
    expect((await create(user, "rollback-extra")).statusCode).toBe(500);
  } finally {
    spy.mockRestore();
  }
  expect(
    await db.prisma.organization.count({ where: { slug: "rollback-extra" } }),
  ).toBe(0);
  expect(await db.prisma.member.count({ where: { userId: user.id } })).toBe(1);
  expect(
    (
      await app.inject({
        method: "GET",
        url: "/api/v1/me",
        headers: user.headers,
      })
    ).json<unknown>(),
  ).toMatchObject({ organization: { id: initial.organization_id } });
  expect((await create(user, "rollback-extra")).statusCode).toBe(200);
});

// @req R-SAAS-01 @req R-ORG-04
it("requires verified native cookies and leaves customer/public creation operator-only", async () => {
  const user = await identity("gates");
  await create(user, "gates-initial", "/api/v1/onboarding");
  const issued = await key(user, "Gate key");
  const fromKey = await app.inject({
    method: "POST",
    url: "/api/v1/me/organizations",
    headers: { authorization: `Bearer ${issued.key}` },
    payload: { name: "Forbidden", slug: "key-forbidden" },
  });
  expect(fromKey.statusCode).toBe(403);
  await verifyEmail(db, user.id, false);
  expect((await create(user, "unverified-forbidden")).statusCode).toBe(403);
  await verifyEmail(db, user.id);
  const context = { ...operatorContext(), headers: new Headers(user.headers) };
  for (const instanceMode of ["customer", "public"] as const) {
    const auth = new AuthService(
      db.prisma,
      { ...testAuthConfiguration, instanceMode },
      db.audit,
    );
    await expect(
      auth.createOrganization(context, {
        name: "Forbidden",
        slug: `${instanceMode}-forbidden`,
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  }
  expect(
    await db.prisma.organization.count({
      where: { slug: { endsWith: "forbidden" } },
    }),
  ).toBe(0);
});

// @req R-SAAS-01 @req R-SAAS-03 @req R-ORG-04
it("keeps keys, capture data and monthly billing isolated and returns human-readable owner identity only for current-org keys", async () => {
  const user = await identity("key-display");
  const first = onboardingOutputSchema.parse(
    (
      await create(user, "key-display-first", "/api/v1/onboarding")
    ).json<unknown>(),
  );
  const firstKey = await key(user, "First key");
  expect(firstKey.metadata).toMatchObject({
    user_id: user.id,
    user_email: user.email,
    user_name: "key-display owner",
  });
  const body = testEnvelope({
    context: { cwd: "/org-isolation", installation: { osUser: "fixture" } },
    records: [textRecord(0, "Organization isolation evidence")],
  });
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/v1/ingest",
        headers: { authorization: `Bearer ${firstKey.key}` },
        payload: body,
      })
    ).statusCode,
  ).toBe(202);
  const second = onboardingOutputSchema.parse(
    (await create(user, "key-display-second")).json<unknown>(),
  );
  const secondKey = await key(user, "Second key");
  const listed = keysOutputSchema.parse(
    (
      await app.inject({
        method: "GET",
        url: "/api/v1/admin/keys",
        headers: user.headers,
      })
    ).json<unknown>(),
  );
  expect(listed.items.map((row) => row.id)).toEqual([secondKey.metadata.id]);
  expect(listed.items[0]).toMatchObject({
    organization_id: second.organization_id,
    user_id: user.id,
    user_email: user.email,
    user_name: "key-display owner",
  });
  const sessions = await app.inject({
    method: "GET",
    url: "/api/v1/sessions",
    headers: { authorization: `Bearer ${secondKey.key}` },
  });
  expect(sessions.json<unknown>()).toMatchObject({ items: [] });
  const usage = await app.inject({
    method: "GET",
    url: "/api/v1/billing",
    headers: user.headers,
  });
  expect(usage.json<unknown>()).toMatchObject({
    plan: "free",
    records_used: 0,
  });
  const other = await identity("foreign-key-display");
  await create(other, "foreign-key-org");
  await key(other, "Foreign key");
  const still = await app.inject({
    method: "GET",
    url: "/api/v1/admin/keys",
    headers: user.headers,
  });
  expect(still.body).not.toContain(other.email);
  expect(still.body).not.toContain(other.id);
  const old = await runtime.services.auth.authenticate(
    new Headers({ authorization: `Bearer ${firstKey.key}` }),
    operatorContext(),
  );
  expect(old.caller?.organizationId).toBe(first.organization_id);
});

// @req R-SAAS-09 @req R-SAAS-01
it("derives a unique URL slug from the organization name when none is given", async () => {
  const user = await identity("derived");
  const first = await app.inject({
    method: "POST",
    url: "/api/v1/onboarding",
    headers: user.headers,
    payload: { name: "Acme Robotics & Co." },
  });
  expect(first.statusCode, first.body).toBe(200);
  const second = await app.inject({
    method: "POST",
    url: "/api/v1/me/organizations",
    headers: user.headers,
    payload: { name: "Acme Robotics & Co." },
  });
  expect(second.statusCode, second.body).toBe(200);
  const listed = await app.inject({
    method: "GET",
    url: "/api/v1/me/organizations",
    headers: user.headers,
  });
  expect(
    z
      .object({ organizations: z.array(z.object({ slug: z.string() })) })
      .parse(listed.json<unknown>())
      .organizations.map((organization) => organization.slug)
      .sort(),
  ).toEqual(["acme-robotics-co", "acme-robotics-co-2"]);
});
