import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { hasAdminAuthority, type PrismaClient } from "@agentcommons/db";
import { afterAll, beforeAll, expect, it } from "vitest";
import { z } from "zod";
import { createAuth, type AuthConfiguration } from "../src/auth/config.js";
import { bootstrap, operatorContext, recover } from "../src/auth/bootstrap.js";
import { AuthService } from "../src/services/auth.js";
import { AuditService } from "../src/services/audit.js";
import { MembershipService } from "../src/services/membership.js";
import type { ServiceContext } from "../src/services/context.js";
import {
  claimSetup,
  contextFor,
  cookieHeader,
  loginAs,
  releaser,
  setupToken,
  startDatabase,
  type TestDatabase,
} from "./support.js";

const { defer, release } = releaser();
let database: TestDatabase;
let prisma: PrismaClient;
let databaseUrl: string;
let auth: AuthService;
let members: MembershipService;
let audit: AuditService;
let ownerA: ServiceContext;
let ownerB: ServiceContext;
const config: AuthConfiguration = {
  publicUrl: "http://localhost:3000",
  secret: "production-auth-integration-secret-at-least-32-bytes",
  emailPasswordEnabled: true,
  signupMode: "invite",
  allowedEmailDomains: [],
};
const password = "Test password with enough entropy 42!";
const context = (headers: Headers) => contextFor(database, headers);
const login = (email: string) => loginAs(database, email, password);
const claim = (url: string | null) => claimSetup(database, url, password);
async function add(
  owner: ServiceContext,
  email: string,
  role: "member" | "admin" | "owner" = "member",
) {
  const response = await members.add(owner, { emails: [email], role });
  const item = response.result.results[0];
  if (!item?.user_id) throw new Error("User not created");
  return item;
}

beforeAll(async () => {
  database = await startDatabase(config);
  defer(() => database.close());
  prisma = database.prisma;
  databaseUrl = database.urls.app;
  audit = database.audit;
  auth = database.auth;
  members = new MembershipService(prisma, config, audit);
  const first = await bootstrap(prisma, config, {
    email: "owner-a@example.test",
    organization: "org-a",
  });
  await claim(first.result.setup_url);
  ownerA = await login("owner-a@example.test");
  const second = await bootstrap(prisma, config, {
    email: "owner-b@example.test",
    organization: "org-b",
  });
  await claim(second.result.setup_url);
  ownerB = await login("owner-b@example.test");
}, 120_000);
afterAll(release);

it("bootstraps idempotently without public password signup or authentication management bypass", async () => {
  const repeat = await bootstrap(prisma, config, {
    email: "owner-a@example.test",
    organization: "org-a",
  });
  expect(repeat.result.setup_url).toBeNull();
  expect(repeat.result.organization_id).toBe(ownerA.caller?.organizationId);
  await expect(
    auth.native.api.signUpEmail({
      body: { email: "outsider@example.test", name: "Outsider", password },
    }),
  ).rejects.toMatchObject({ statusCode: 400 });
  for (const path of [
    "sign-up/email",
    "request-password-reset",
    "admin/create-user",
    "organization/add-member",
    "api-key/create",
    "organization/create",
  ]) {
    await expect(
      auth.handle(
        new Request(`${config.publicUrl}/auth/${path}`, { method: "POST" }),
        ownerA,
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
  }
  expect(() =>
    createAuth(prisma, { ...config, emailPasswordEnabled: false }),
  ).toThrow("Configure at least one login method");
});

// @req R-AUTH-03
it("uses native single-use initial setup, blocks cross-organization account recovery and invalidates sibling tokens", async () => {
  const added = await add(ownerA, "SETUP@example.test");
  expect(added.email).toBe("setup@example.test");
  expect(added.setup_url).toBeTruthy();
  const userId = z.string().parse(added.user_id);
  expect(await prisma.account.count({ where: { userId } })).toBe(0);
  await expect(add(ownerB, added.email)).rejects.toMatchObject({
    code: "IDENTITY_UNCLAIMED",
  });
  const reissued = await members.passwordSetup(ownerA, userId);
  await claim(reissued.result.setup_url);
  await expect(claim(added.setup_url)).rejects.toMatchObject({
    statusCode: 400,
  });
  await expect(claim(reissued.result.setup_url)).rejects.toMatchObject({
    statusCode: 400,
  });
  expect(
    await prisma.account.count({ where: { userId, providerId: "credential" } }),
  ).toBe(1);
  await add(ownerB, added.email);
  await expect(members.passwordSetup(ownerA, userId)).rejects.toMatchObject({
    code: "IDENTITY_ESTABLISHED",
  });
  await expect(members.passwordSetup(ownerB, userId)).rejects.toMatchObject({
    code: "IDENTITY_ESTABLISHED",
  });
  const recovery = await recover(prisma, config, added.email);
  await claim(recovery.result.setup_url);
  const records = await prisma.auditEvent.findMany({
    where: { resourceIds: { has: userId } },
  });
  expect(JSON.stringify(records)).not.toContain(
    setupToken(reissued.result.setup_url),
  );
  expect(JSON.stringify(records)).not.toContain(
    setupToken(recovery.result.setup_url),
  );
});

it("keeps API keys in one organization and applies issuer demotion, suspension, revocation and least privilege immediately", async () => {
  const added = await add(ownerA, "issuer@example.test", "admin");
  await claim(added.setup_url);
  let issuer = await login(added.email);
  const key = await auth.createKey(issuer, {
    name: "admin",
    permissions: { sessions: ["read", "ingest"], admin: ["*"] },
  });
  const keyHeaders = new Headers({ authorization: `Bearer ${key.result.key}` });
  let keyContext = await context(keyHeaders);
  expect(keyContext.caller?.organizationId).toBe(ownerA.caller?.organizationId);
  expect(keyContext.caller && hasAdminAuthority(keyContext.caller)).toBe(true);
  const stored = await prisma.apikey.findUniqueOrThrow({
    where: { id: key.result.metadata.id },
  });
  expect(stored.key).not.toBe(key.result.key);
  expect(
    (
      await prisma.apiKeyOwner.findUniqueOrThrow({
        where: { keyId: stored.id },
      })
    ).userId,
  ).toBe(added.user_id);
  await expect(
    context(
      new Headers({
        authorization: `Bearer ${key.result.key}`,
        "x-organization-id": ownerB.caller?.organizationId ?? "",
      }),
    ),
  ).rejects.toMatchObject({ statusCode: 401 });
  await expect(
    auth.createKey(keyContext, {
      name: "child",
      permissions: { sessions: ["read"] },
    }),
  ).rejects.toMatchObject({ code: "COOKIE_REQUIRED" });
  await expect(
    members.add(keyContext, { emails: ["no@example.test"], role: "member" }),
  ).rejects.toMatchObject({ code: "COOKIE_REQUIRED" });
  await expect(
    auth.revokeKey(ownerB, stored.id, { reason: "Revoke key" }, false),
  ).rejects.toMatchObject({
    statusCode: 404,
  });
  const member = await prisma.member.findFirstOrThrow({
    where: {
      organizationId: z.string().parse(issuer.caller?.organizationId),
      userId: added.user_id ?? "",
    },
  });
  await members.role(ownerA, member.id, {
    role: "member",
    reason: "Reduce authority",
  });
  keyContext = await context(keyHeaders);
  expect(keyContext.caller?.role).toBe("member");
  expect(keyContext.caller && hasAdminAuthority(keyContext.caller)).toBe(false);
  issuer = await login(added.email);
  await expect(
    auth.createKey(issuer, { name: "escalate", permissions: { admin: ["*"] } }),
  ).rejects.toMatchObject({ statusCode: 403 });
  await members.suspend(ownerA, member.id, {
    suspended: true,
    reason: "Pause membership",
  });
  await expect(context(keyHeaders)).rejects.toMatchObject({ statusCode: 403 });
  await members.suspend(ownerA, member.id, {
    suspended: false,
    reason: "Restore membership",
  });
  await auth.revokeKey(ownerA, stored.id, { reason: "Revoke key" }, false);
  await expect(context(keyHeaders)).rejects.toMatchObject({ statusCode: 401 });
  expect(await prisma.apiKeyOwner.count({ where: { keyId: stored.id } })).toBe(
    1,
  );
});

it("switches cookie organization while key authority stays fixed and scopes membership lists and cursors", async () => {
  await add(ownerB, "owner-a@example.test", "member");
  const fresh = await login("owner-a@example.test");
  expect(fresh.caller).toBeNull();
  expect((await auth.organizations(fresh)).result.organizations).toHaveLength(
    2,
  );
  await auth.switchOrganization(
    fresh,
    z.string().parse(ownerA.caller?.organizationId),
  );
  ownerA = await context(fresh.headers);
  expect(ownerA.caller?.role).toBe("owner");
  const page = await members.list(ownerA, { limit: 1 });
  expect(page.result.items).toHaveLength(1);
  expect(page.result.cursor).toBeTruthy();
  await expect(
    members.list(ownerB, {
      limit: 1,
      cursor: z.string().parse(page.result.cursor),
    }),
  ).rejects.toMatchObject({ statusCode: 400 });
  expect(
    (await members.list(ownerB, {})).result.items.every(
      (member) => member.organization_id === ownerB.caller?.organizationId,
    ),
  ).toBe(true);
});

it("preserves one active owner under concurrent suspension and blocks last-owner role or removal", async () => {
  const other = await add(ownerA, "second-owner@example.test", "owner");
  await claim(other.setup_url);
  const second = await login(other.email);
  const ownerMember = await prisma.member.findFirstOrThrow({
    where: {
      organizationId: z.string().parse(ownerA.caller?.organizationId),
      userId: z.string().parse(ownerA.caller?.userId),
    },
  });
  const secondMember = await prisma.member.findFirstOrThrow({
    where: {
      organizationId: z.string().parse(second.caller?.organizationId),
      userId: z.string().parse(second.caller?.userId),
    },
  });
  const outcomes = await Promise.allSettled([
    members.suspend(ownerA, ownerMember.id, {
      suspended: true,
      reason: "Concurrent suspension",
    }),
    members.suspend(second, secondMember.id, {
      suspended: true,
      reason: "Concurrent suspension",
    }),
  ]);
  expect(
    outcomes.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(
    await prisma.member.count({
      where: {
        organizationId: z.string().parse(ownerA.caller?.organizationId),
        role: "owner",
        suspended: false,
      },
    }),
  ).toBe(1);
  const remaining = await prisma.member.findFirstOrThrow({
    where: {
      organizationId: z.string().parse(ownerA.caller?.organizationId),
      role: "owner",
      suspended: false,
    },
  });
  const active = remaining.id === ownerMember.id ? ownerA : second;
  await expect(
    members.role(active, remaining.id, {
      role: "member",
      reason: "Lose ownership",
    }),
  ).rejects.toMatchObject({ code: "LAST_OWNER" });
  await expect(
    members.remove(active, remaining.id, { reason: "Leave organization" }),
  ).rejects.toMatchObject({ code: "LAST_OWNER" });
  const suspended =
    remaining.id === ownerMember.id ? secondMember : ownerMember;
  await members.suspend(active, suspended.id, {
    suspended: false,
    reason: "Restore owner",
  });
});

it("rolls native membership changes back when audit persistence fails and bounds redacted audit detail", async () => {
  const badContext = { ...ownerB, requestId: "x".repeat(1_000_000) };
  const failAudit = new AuditService(prisma);
  const failedMembers = new MembershipService(prisma, config, failAudit);
  const original = failAudit.write.bind(failAudit);
  failAudit.write = () => Promise.reject(new Error("Audit persistence failed"));
  await expect(
    failedMembers.add(badContext, {
      emails: ["rollback@example.test"],
      role: "member",
    }),
  ).rejects.toThrow("Audit persistence failed");
  expect(
    await prisma.user.findUnique({ where: { email: "rollback@example.test" } }),
  ).toBeNull();
  failAudit.write = original;
  const event = await audit.write(ownerB, {
    action: "test.audit",
    detail: {
      huge: "é".repeat(30_000),
      authorization: "Bearer ac_abcdefghijklmnopqrstuvwxyz",
    },
  });
  expect(Buffer.byteLength(JSON.stringify(event.detail))).toBeLessThanOrEqual(
    8192,
  );
  expect(JSON.stringify(event.detail)).not.toContain(
    "abcdefghijklmnopqrstuvwxyz",
  );
  const before = await prisma.auditEvent.count();
  await expect(
    auth.authenticate(
      new Headers({ authorization: "Bearer invalid" }),
      operatorContext(),
    ),
  ).rejects.toMatchObject({ audited: true });
  expect(await prisma.auditEvent.count()).toBe(before + 1);
});

let providerProfile = {
  id: "fixture-subject",
  email: "sso@example.test",
  name: "SSO user",
  emailVerified: true,
};
function oauthConfig(
  mode: AuthConfiguration["signupMode"] = "invite",
  domains: string[] = [],
): AuthConfiguration {
  return {
    ...config,
    signupMode: mode,
    allowedEmailDomains: domains,
    oauthProviders: [
      {
        providerId: "fixture",
        clientId: "fixture-client",
        authorizationUrl: "https://idp.example.test/authorize",
        getToken: () =>
          Promise.resolve({
            accessToken: "fixture-token",
            scopes: ["openid", "email"],
          }),
        getUserInfo: () => Promise.resolve(providerProfile),
      },
    ],
  };
}
async function oauthLogin(service: AuthService): Promise<Response> {
  const started = await service.handle(
    new Request(`${config.publicUrl}/auth/sign-in/social`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: config.publicUrl },
      body: JSON.stringify({
        provider: "fixture",
        callbackURL: config.publicUrl,
      }),
    }),
    operatorContext(),
  );
  expect(started.result.status).toBe(200);
  const { url } = z.object({ url: z.url() }).parse(await started.result.json());
  const state = new URL(url).searchParams.get("state");
  return (
    await service.handle(
      new Request(
        `${config.publicUrl}/auth/callback/fixture?code=fixture-code&state=${encodeURIComponent(state ?? "")}`,
        { headers: { cookie: cookieHeader(started.result) } },
      ),
      operatorContext(),
    )
  ).result;
}

// @req R-ORG-03
it("claims only verified allowlisted SSO identities and invalidates their outstanding password setup links", async () => {
  const pending = await add(ownerB, "sso@example.test");
  const service = new AuthService(prisma, oauthConfig(), audit);
  providerProfile.emailVerified = false;
  const rejected = await oauthLogin(service);
  expect(rejected.headers.get("location")).toContain("error=");
  expect(
    await prisma.account.count({ where: { userId: pending.user_id ?? "" } }),
  ).toBe(0);
  providerProfile.emailVerified = true;
  const accepted = await oauthLogin(service);
  expect(accepted.headers.get("location")).toBe(config.publicUrl);
  expect(
    await prisma.account.count({
      where: { userId: pending.user_id ?? "", providerId: "fixture" },
    }),
  ).toBe(1);
  await expect(claim(pending.setup_url)).rejects.toMatchObject({
    statusCode: 400,
  });
  await expect(
    members.passwordSetup(ownerB, pending.user_id ?? ""),
  ).rejects.toMatchObject({ code: "IDENTITY_ESTABLISHED" });
  const expired = await add(ownerB, "expired@example.test");
  await prisma.verification.updateMany({
    where: { value: expired.user_id ?? "" },
    data: { expiresAt: new Date(0) },
  });
  await expect(claim(expired.setup_url)).rejects.toMatchObject({
    statusCode: 400,
  });
  expect(await prisma.invitation.count()).toBe(0);
});

// @req R-AUTH-01
// @req R-ORG-01
it("enforces SSO signup modes and allowed domains without public organization membership or creation", async () => {
  for (const mode of ["invite", "closed"] as const) {
    providerProfile = {
      ...providerProfile,
      id: `${mode}-subject`,
      email: `${mode}@example.test`,
    };
    const response = await oauthLogin(
      new AuthService(prisma, oauthConfig(mode), audit),
    );
    expect(response.headers.get("location")).toContain("error=");
    expect(
      await prisma.user.findUnique({ where: { email: providerProfile.email } }),
    ).toBeNull();
  }
  providerProfile = {
    ...providerProfile,
    id: "open-subject",
    email: "open@example.test",
  };
  const open = new AuthService(prisma, oauthConfig("open"), audit);
  const accepted = await oauthLogin(open);
  expect(accepted.headers.get("location")).toBe(config.publicUrl);
  const created = await prisma.user.findUniqueOrThrow({
    where: { email: providerProfile.email },
  });
  expect(await prisma.member.count({ where: { userId: created.id } })).toBe(0);
  const noMembership = await context(
    new Headers({ cookie: cookieHeader(accepted) }),
  );
  expect(noMembership.caller).toBeNull();
  expect((await auth.me(noMembership)).result.organization).toBeNull();
  await expect(
    open.handle(
      new Request(`${config.publicUrl}/auth/organization/create`, {
        method: "POST",
      }),
      noMembership,
    ),
  ).rejects.toMatchObject({ statusCode: 404 });
  providerProfile = {
    ...providerProfile,
    id: "wrong-domain",
    email: "outsider@wrong.test",
  };
  const denied = await oauthLogin(
    new AuthService(prisma, oauthConfig("open", ["example.test"]), audit),
  );
  expect(denied.headers.get("location")).toContain("error=");
  expect(
    await prisma.user.findUnique({ where: { email: providerProfile.email } }),
  ).toBeNull();
});

it("accepts only one of two concurrent initial credentials and prevents cross-organization provisioning races", async () => {
  const pending = await add(ownerB, "concurrent-setup@example.test");
  const second = await members.passwordSetup(ownerB, pending.user_id ?? "");
  const reset = (url: string | null) =>
    auth.handle(
      new Request(`${config.publicUrl}/auth/reset-password`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: config.publicUrl,
        },
        body: JSON.stringify({ token: setupToken(url), newPassword: password }),
      }),
      operatorContext(),
    );
  const outcomes = await Promise.allSettled([
    reset(pending.setup_url),
    reset(second.result.setup_url),
  ]);
  expect(
    outcomes.filter(
      (value) =>
        value.status === "fulfilled" && value.value.result.status === 200,
    ),
  ).toHaveLength(1);
  expect(
    await prisma.account.count({
      where: { userId: pending.user_id ?? "", providerId: "credential" },
    }),
  ).toBe(1);
  const additions = await Promise.allSettled([
    add(ownerA, "concurrent-add@example.test"),
    add(ownerB, "concurrent-add@example.test"),
  ]);
  expect(
    additions.filter((value) => value.status === "fulfilled"),
  ).toHaveLength(1);
  const user = await prisma.user.findUniqueOrThrow({
    where: { email: "concurrent-add@example.test" },
  });
  expect(await prisma.member.count({ where: { userId: user.id } })).toBe(1);
});

// @req R-AUTH-04
// @req R-SEC-04
// @req R-ORG-04
it("evaluates role and key permission intersections and leaves other-organization keys active after removal", async () => {
  const person = await add(ownerB, "matrix@example.test", "admin");
  await claim(person.setup_url);
  let browser = await login(person.email);
  const readOnly = await auth.createKey(browser, {
    name: "read",
    permissions: { sessions: ["read"] },
  });
  const privileged = await auth.createKey(browser, {
    name: "admin",
    permissions: { sessions: ["read"], admin: ["*"] },
  });
  const readonlyContext = await context(
    new Headers({ "x-api-key": readOnly.result.key }),
  );
  expect(
    readonlyContext.caller && hasAdminAuthority(readonlyContext.caller),
  ).toBe(false);
  await expect(members.list(readonlyContext, {})).rejects.toMatchObject({
    statusCode: 403,
  });
  await expect(
    auth.revokeKey(
      readonlyContext,
      privileged.result.metadata.id,
      { reason: "Revoke key" },
      false,
    ),
  ).rejects.toMatchObject({ statusCode: 403 });
  expect(
    (await auth.listKeys(browser, {})).result.items.some(
      (key) => key.id === readOnly.result.metadata.id,
    ),
  ).toBe(true);
  await add(ownerA, person.email, "member");
  await auth.switchOrganization(
    browser,
    z.string().parse(ownerA.caller?.organizationId),
  );
  browser = await context(browser.headers);
  const other = await auth.createKey(browser, {
    name: "other",
    permissions: { sessions: ["read"] },
  });
  const target = await prisma.member.findFirstOrThrow({
    where: {
      organizationId: z.string().parse(ownerB.caller?.organizationId),
      userId: person.user_id ?? "",
    },
  });
  await members.remove(ownerB, target.id, {
    reason: "Remove one organization membership",
  });
  await expect(
    context(new Headers({ authorization: `Bearer ${privileged.result.key}` })),
  ).rejects.toMatchObject({ statusCode: 403 });
  expect(
    (
      await context(
        new Headers({ authorization: `Bearer ${other.result.key}` }),
      )
    ).caller?.organizationId,
  ).toBe(ownerA.caller?.organizationId);
  await prisma.user.update({
    where: { id: person.user_id ?? "" },
    data: { role: "admin" },
  });
  expect(
    (
      await context(
        new Headers({ authorization: `Bearer ${other.result.key}` }),
      )
    ).caller?.role,
  ).toBe("member");
});

// @req R-ORG-05
it("reports existing members without changing identities or roles and permits ownership grants only by owners", async () => {
  const existing = await add(ownerB, "owner-b@example.test", "member");
  expect(existing.status).toBe("existing");
  expect(existing.setup_url).toBeNull();
  expect(
    (
      await prisma.member.findFirstOrThrow({
        where: {
          organizationId: z.string().parse(ownerB.caller?.organizationId),
          userId: existing.user_id ?? "",
        },
      })
    ).role,
  ).toBe("owner");
  const admin = await add(ownerB, "org-admin@example.test", "admin");
  await claim(admin.setup_url);
  const browser = await login(admin.email);
  await expect(
    add(browser, "cannot-own@example.test", "owner"),
  ).rejects.toMatchObject({ code: "OWNER_REQUIRED" });
  const owner = await prisma.member.findFirstOrThrow({
    where: {
      organizationId: z.string().parse(ownerB.caller?.organizationId),
      role: "owner",
    },
  });
  await expect(
    members.role(browser, owner.id, {
      role: "member",
      reason: "Cannot demote owner",
    }),
  ).rejects.toMatchObject({ code: "OWNER_REQUIRED" });
  await expect(
    members.suspend(browser, owner.id, {
      suspended: true,
      reason: "Cannot suspend owner",
    }),
  ).rejects.toMatchObject({ code: "OWNER_REQUIRED" });
  await expect(
    members.remove(browser, owner.id, { reason: "Cannot remove owner" }),
  ).rejects.toMatchObject({ code: "OWNER_REQUIRED" });
  expect(
    await prisma.user.count({ where: { email: "cannot-own@example.test" } }),
  ).toBe(0);
});

// @req R-AUTH-02
it("runs operator seed and recovery entry points and audits their single-use credential delivery", async () => {
  const environment = {
    ...process.env,
    PUBLIC_URL: config.publicUrl,
    DATABASE_URL: databaseUrl,
    BETTER_AUTH_SECRET: config.secret,
  };
  const execute = async (file: string, args: string[]) => {
    const response = await promisify(execFile)(
      "pnpm",
      ["exec", "tsx", file, ...args],
      { cwd: new URL("../../../", import.meta.url), env: environment },
    );
    return z
      .looseObject({ setup_url: z.url().nullable() })
      .parse(JSON.parse(response.stdout.trim().split("\n").at(-1) ?? "null"));
  };
  const seeded = await execute("apps/api/src/seed.ts", [
    "--admin",
    "cli-owner@example.test",
    "--organization",
    "cli-org",
  ]);
  await claim(seeded.setup_url);
  const repeated = await execute("apps/api/src/seed.ts", [
    "--admin",
    "cli-owner@example.test",
    "--organization",
    "cli-org",
  ]);
  expect(repeated.setup_url).toBeNull();
  const recovered = await execute("apps/api/src/recover.ts", [
    "--email",
    "cli-owner@example.test",
  ]);
  await claim(recovered.setup_url);
  await expect(claim(recovered.setup_url)).rejects.toMatchObject({
    statusCode: 400,
  });
  const user = await prisma.user.findUniqueOrThrow({
    where: { email: "cli-owner@example.test" },
  });
  const events = await prisma.auditEvent.findMany({
    where: { resourceIds: { has: user.id } },
  });
  expect(
    events.filter((event) => event.action === "operator.recover"),
  ).toHaveLength(1);
  expect(events.every((event) => event.authMethod === "operator")).toBe(true);
  expect(
    await prisma.member.count({ where: { userId: user.id, role: "owner" } }),
  ).toBe(1);
});

it("writes one redacted failure audit before returning authorization errors and one audit per successful key operation", async () => {
  const identity = await login("org-admin@example.test");
  const request = { ...identity, requestId: crypto.randomUUID() };
  await expect(
    members.add(request, { emails: ["new-owner@example.test"], role: "owner" }),
  ).rejects.toMatchObject({ audited: true, statusCode: 403 });
  const failed = await prisma.auditEvent.findMany({
    where: { requestId: request.requestId },
  });
  expect(failed).toHaveLength(1);
  expect(failed[0]?.action).toBe("members.add");
  expect(failed[0]?.statusCode).toBe(403);
  const success = { ...ownerB, requestId: crypto.randomUUID() };
  const key = await auth.createKey(success, {
    name: "ac_abcdefghijklmnopqrstuvwxyz",
    permissions: { sessions: ["read"] },
  });
  expect(key.result.metadata.name).not.toContain("abcdefghijklmnopqrstuvwxyz");
  expect(
    await prisma.auditEvent.count({ where: { requestId: success.requestId } }),
  ).toBe(1);
  const read = { ...ownerB, requestId: crypto.randomUUID() };
  const listed = await auth.listKeys(read, {});
  expect(listed.audit.requestId).toBe(read.requestId);
  expect(
    await prisma.auditEvent.count({ where: { requestId: read.requestId } }),
  ).toBe(1);
});

it("cannot leave a usable setup credential when verified SSO races initial setup issuance", async () => {
  const pending = await add(ownerB, "sso-setup-race@example.test");
  providerProfile = {
    id: "sso-setup-race",
    email: pending.email,
    name: "Race member",
    emailVerified: true,
  };
  const service = new AuthService(prisma, oauthConfig(), audit);
  const outcomes = await Promise.allSettled([
    oauthLogin(service),
    members.passwordSetup(ownerB, pending.user_id ?? ""),
  ]);
  const callback = outcomes[0];
  if (
    callback.status !== "fulfilled" ||
    callback.value.headers.get("location") !== config.publicUrl
  ) {
    // A serializable conflict may abort either transaction; retry only the SSO operation.
    expect((await oauthLogin(service)).headers.get("location")).toBe(
      config.publicUrl,
    );
  }
  expect(
    await prisma.account.count({
      where: { userId: pending.user_id ?? "", providerId: "fixture" },
    }),
  ).toBe(1);
  const setup = outcomes[1];
  if (setup.status === "fulfilled")
    await expect(claim(setup.value.result.setup_url)).rejects.toMatchObject({
      statusCode: 400,
    });
  await expect(claim(pending.setup_url)).rejects.toMatchObject({
    statusCode: 400,
  });
  expect(
    await prisma.account.count({
      where: { userId: pending.user_id ?? "", providerId: "credential" },
    }),
  ).toBe(0);
});

// @req R-AUTH-04
it("uses the same native and shared key-name and expiration bounds", async () => {
  const shortest = await auth.createKey(ownerB, {
    name: "x",
    permissions: { sessions: ["read"] },
    expires_in: 1,
  });
  const longest = await auth.createKey(ownerB, {
    name: "x".repeat(128),
    permissions: { sessions: ["read"] },
    expires_in: 31_536_000,
  });
  expect(shortest.result.metadata.expires_at).not.toBeNull();
  expect(longest.result.metadata.name).toHaveLength(128);
  for (const input of [
    { name: "x".repeat(129), expires_in: 1 },
    { name: "x", expires_in: 0 },
    { name: "x", expires_in: 31_536_001 },
  ]) {
    await expect(
      auth.createKey(ownerB, { ...input, permissions: { sessions: ["read"] } }),
    ).rejects.toMatchObject({ statusCode: 400 });
  }
});

it("applies the configured domain restriction to password sessions and existing cookies and API keys", async () => {
  const key = await auth.createKey(ownerB, {
    name: "domain",
    permissions: { sessions: ["read"] },
  });
  const restricted = new AuthService(
    prisma,
    { ...config, allowedEmailDomains: ["different.test"] },
    audit,
  );
  await expect(
    restricted.native.api.signInEmail({
      body: { email: "owner-b@example.test", password },
    }),
  ).rejects.toMatchObject({ statusCode: 403 });
  await expect(
    restricted.authenticate(ownerB.headers, operatorContext()),
  ).rejects.toMatchObject({ statusCode: 403 });
  await expect(
    restricted.authenticate(
      new Headers({ authorization: `Bearer ${key.result.key}` }),
      operatorContext(),
    ),
  ).rejects.toMatchObject({ statusCode: 403 });
});
