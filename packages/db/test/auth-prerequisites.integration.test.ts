import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PrismaClient, type Prisma } from "@prisma/client";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { afterAll, beforeAll, expect, it } from "vitest";
import { z } from "zod";
import { authPlugins } from "../src/auth-plugins.js";

const cleanup: (() => Promise<unknown>)[] = [];
let prisma: PrismaClient;
const resetDeliveries = new Map<string, { token: string; url: string }>();
let providerProfile = {
  id: "provider-subject",
  email: "sso@example.test",
  name: "SSO member",
  emailVerified: true,
};

function createAuth(
  db: PrismaClient | Prisma.TransactionClient,
  requireLocalEmailVerified = false,
) {
  return betterAuth({
    baseURL: "http://localhost:3000",
    basePath: "/auth",
    secret: "auth-prerequisites-test-secret-with-at-least-thirty-two-bytes",
    database: prismaAdapter(db, { provider: "postgresql" }),
    plugins: authPlugins([
      {
        providerId: "fixture",
        clientId: "fixture-client",
        authorizationUrl: "https://idp.example.test/authorize",
        getToken: () =>
          Promise.resolve({
            accessToken: "fixture-access-token",
            scopes: ["openid", "email"],
          }),
        getUserInfo: () => Promise.resolve(providerProfile),
      },
    ]),
    account: {
      accountLinking: {
        enabled: true,
        requireLocalEmailVerified,
        trustedProviders: [],
      },
    },
    user: {
      validateUserInfo: ({ user, source }) => {
        if (source.method === "oauth" && user.emailVerified !== true)
          return { error: "provider_email_unverified" };
      },
    },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      resetPasswordTokenExpiresIn: 60,
      sendResetPassword: ({ user, token, url }) => {
        resetDeliveries.set(user.email, { token, url });
        return Promise.resolve();
      },
    },
    logger: { level: "error" },
  });
}

beforeAll(async () => {
  const container = await new PostgreSqlContainer("postgres:16").start();
  cleanup.push(() => container.stop());
  const urls = ["ac_app", "ac_trace_control"].map((role) => {
    const url = new URL(container.getConnectionUri());
    url.username = role;
    url.password = "test-password";
    return url.toString();
  });
  await promisify(execFile)("pnpm", ["migrate"], {
    cwd: new URL("../", import.meta.url),
    env: {
      ...process.env,
      DATABASE_MIGRATION_URL: container.getConnectionUri(),
      DATABASE_URL: urls[0],
      DATABASE_TRACE_CONTROL_URL: urls[1],
    },
  });
  prisma = new PrismaClient({ datasourceUrl: container.getConnectionUri() });
  cleanup.push(() => prisma.$disconnect());
}, 120_000);

afterAll(async () => {
  for (const close of cleanup.reverse()) await close();
});

it("adds native user and organization membership without a password, invitation, or email", async () => {
  const auth = createAuth(prisma);
  const owner = await auth.api.createUser({
    body: { email: "bootstrap@example.test", name: "Owner" },
  });
  const organization = await auth.api.createOrganization({
    body: { name: "Test organization", slug: "test", userId: owner.user.id },
  });
  expect(organization).not.toBeNull();
  const member = await auth.api.createUser({
    body: { email: "MEMBER@example.test", name: "Member" },
  });
  expect(member.user.email).toBe("member@example.test");
  expect(member.user.emailVerified).toBe(false);
  expect(
    await prisma.account.count({ where: { userId: member.user.id } }),
  ).toBe(0);
  const added = await auth.api.addMember({
    body: {
      organizationId: organization.id,
      userId: member.user.id,
      role: "member",
    },
  });
  expect(added.userId).toBe(member.user.id);
  expect(added.role).toBe("member");
  await expect(
    auth.api.addMember({
      body: {
        organizationId: organization.id,
        userId: member.user.id,
        role: "admin",
      },
    }),
  ).rejects.toMatchObject({ status: "BAD_REQUEST" });
  expect(
    await prisma.member.count({
      where: { userId: member.user.id, organizationId: organization.id },
    }),
  ).toBe(1);
  expect(await prisma.invitation.count()).toBe(0);
  expect(resetDeliveries.size).toBe(0);
  await expect(
    auth.api.signInEmail({
      body: { email: member.user.email, password: "some-unknown-password" },
    }),
  ).rejects.toMatchObject({ status: "UNAUTHORIZED" });
  await expect(
    auth.api.signUpEmail({
      body: {
        email: member.user.email,
        password: "an-attacker-password",
        name: "Attacker",
      },
    }),
  ).rejects.toMatchObject({ status: "BAD_REQUEST" });
});

it("commits native auth mutations and domain audit together, and rolls all back when audit fails", async () => {
  const organization = await prisma.organization.findUniqueOrThrow({
    where: { slug: "test" },
  });
  const add = async (email: string, breakAudit: boolean) =>
    prisma.$transaction(async (tx) => {
      const auth = createAuth(tx);
      const user = await auth.api.createUser({
        body: { email, name: "Transactional member" },
      });
      const member = await auth.api.addMember({
        body: {
          organizationId: organization.id,
          userId: user.user.id,
          role: "member",
        },
      });
      const audit = await tx.auditEvent.create({
        data: {
          id: randomUUID(),
          organizationId: breakAudit
            ? "nonexistent-organization"
            : organization.id,
          requestId: randomUUID(),
          authMethod: "cookie",
          ip: "127.0.0.1",
          transport: "web",
          action: "member.add",
          resourceType: "member",
          resourceIds: [member.id],
          statusCode: 200,
          durationMs: 1,
          detail: { email },
        },
      });
      return { user, member, audit };
    });
  const committed = await add("committed@example.test", false);
  expect(
    await prisma.member.findUnique({ where: { id: committed.member.id } }),
  ).not.toBeNull();
  expect(
    await prisma.auditEvent.findUnique({ where: { id: committed.audit.id } }),
  ).not.toBeNull();
  await expect(add("rolled-back@example.test", true)).rejects.toMatchObject({
    code: "P2003",
  });
  expect(
    await prisma.user.findUnique({
      where: { email: "rolled-back@example.test" },
    }),
  ).toBeNull();
  expect(
    await prisma.auditEvent.count({
      where: {
        detail: { path: ["email"], equals: "rolled-back@example.test" },
      },
    }),
  ).toBe(0);
});

it("uses native expiring single-use password setup tokens without delivering an email", async () => {
  const auth = createAuth(prisma);
  const created = await auth.api.createUser({
    body: { email: "setup@example.test", name: "Setup" },
  });
  await auth.api.requestPasswordReset({
    body: {
      email: created.user.email,
      redirectTo: "http://localhost:3000/reset-password",
    },
  });
  const delivery = resetDeliveries.get(created.user.email);
  expect(delivery?.url).toContain("/auth/reset-password/");
  const token = delivery?.token ?? "";
  expect(token.length).toBeGreaterThan(20);
  await auth.api.resetPassword({
    body: { token, newPassword: "this-is-a-strong-test-password" },
  });
  const login = await auth.api.signInEmail({
    body: {
      email: created.user.email,
      password: "this-is-a-strong-test-password",
    },
  });
  expect(login.user.id).toBe(created.user.id);
  await expect(
    auth.api.resetPassword({
      body: { token, newPassword: "another-strong-test-password" },
    }),
  ).rejects.toMatchObject({ status: "BAD_REQUEST" });
  const credential = await prisma.account.findFirstOrThrow({
    where: { userId: created.user.id, providerId: "credential" },
  });
  expect(credential.password).not.toBe("this-is-a-strong-test-password");
  await auth.api.requestPasswordReset({ body: { email: created.user.email } });
  const expiredToken = resetDeliveries.get(created.user.email)?.token ?? "";
  await prisma.verification.updateMany({
    where: { value: created.user.id },
    data: { expiresAt: new Date(0) },
  });
  await expect(
    auth.api.resetPassword({
      body: {
        token: expiredToken,
        newPassword: "another-strong-test-password",
      },
    }),
  ).rejects.toMatchObject({ status: "BAD_REQUEST" });
});

async function oauthLogin(auth: ReturnType<typeof createAuth>) {
  const response = await auth.handler(
    new Request("http://localhost:3000/auth/sign-in/social", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
      },
      body: JSON.stringify({
        provider: "fixture",
        callbackURL: "http://localhost:3000/",
      }),
    }),
  );
  expect(response.status).toBe(200);
  const body = z.object({ url: z.url() }).parse(await response.json());
  const state = new URL(body.url).searchParams.get("state");
  expect(state).not.toBeNull();
  const cookies = response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
  return auth.handler(
    new Request(
      `http://localhost:3000/auth/callback/fixture?code=fixture-code&state=${encodeURIComponent(state ?? "")}`,
      { headers: { cookie: cookies } },
    ),
  );
}

it("links a verified provider to an unverified allowlisted identity without accepting unverified provider claims", async () => {
  const auth = createAuth(prisma);
  const user = await auth.api.createUser({
    body: { email: "sso@example.test", name: "Pending identity" },
  });
  const organization = await prisma.organization.findUniqueOrThrow({
    where: { slug: "test" },
  });
  await auth.api.addMember({
    body: {
      organizationId: organization.id,
      userId: user.user.id,
      role: "member",
    },
  });
  providerProfile = {
    id: "provider-subject",
    email: user.user.email,
    name: "Provider identity",
    emailVerified: true,
  };
  const blocked = await oauthLogin(createAuth(prisma, true));
  expect(blocked.headers.get("location")).toContain("account_not_linked");
  expect(await prisma.account.count({ where: { userId: user.user.id } })).toBe(
    0,
  );
  const success = await oauthLogin(auth);
  expect(success.status).toBe(302);
  expect(success.headers.get("location")).toBe("http://localhost:3000/");
  expect(
    await prisma.account.count({
      where: { userId: user.user.id, providerId: "fixture" },
    }),
  ).toBe(1);
  expect(
    (await prisma.user.findUniqueOrThrow({ where: { id: user.user.id } }))
      .emailVerified,
  ).toBe(true);
  const unverified = await auth.api.createUser({
    body: { email: "unverified@example.test", name: "Pending identity" },
  });
  providerProfile = {
    id: "unverified-provider-subject",
    email: unverified.user.email,
    name: "Unverified claimant",
    emailVerified: false,
  };
  const denied = await oauthLogin(auth);
  expect(denied.headers.get("location")).toContain("account_not_linked");
  expect(
    await prisma.account.count({ where: { userId: unverified.user.id } }),
  ).toBe(0);
  providerProfile = {
    id: "provider-subject",
    email: user.user.email,
    name: "Changed verification",
    emailVerified: false,
  };
  const returningDenied = await oauthLogin(auth);
  expect(returningDenied.headers.get("location")).toContain(
    "provider_email_unverified",
  );
});

it("creates hashed organization keys with separate immutable issuing-user attribution", async () => {
  const organization = await prisma.organization.findUniqueOrThrow({
    where: { slug: "test" },
  });
  const owner = await prisma.member.findFirstOrThrow({
    where: { organizationId: organization.id, role: "owner" },
  });
  const key = await prisma.$transaction(async (tx) => {
    const auth = createAuth(tx);
    const generated = await auth.api.createApiKey({
      body: {
        organizationId: organization.id,
        userId: owner.userId,
        permissions: { sessions: ["read", "ingest"] },
      },
    });
    await tx.apiKeyOwner.create({
      data: {
        keyId: generated.id,
        organizationId: organization.id,
        userId: owner.userId,
      },
    });
    return generated;
  });
  expect(key.key).toMatch(/^ac_/);
  const stored = await prisma.apikey.findUniqueOrThrow({
    where: { id: key.id },
  });
  expect(stored.referenceId).toBe(organization.id);
  expect(stored.key).not.toBe(key.key);
  const verified = await createAuth(prisma).api.verifyApiKey({
    body: { key: key.key, permissions: { sessions: ["read"] } },
  });
  expect(verified.valid).toBe(true);
  const attribution = await prisma.apiKeyOwner.findUniqueOrThrow({
    where: { keyId: key.id },
  });
  expect(attribution.userId).toBe(owner.userId);
  const member = await prisma.member.findFirstOrThrow({
    where: { organizationId: organization.id, role: "member" },
  });
  const memberKey = await createAuth(prisma).api.createApiKey({
    body: {
      organizationId: organization.id,
      userId: member.userId,
      permissions: { sessions: ["read"] },
    },
  });
  expect(memberKey.referenceId).toBe(organization.id);
});

it("runs native cookie-authenticated membership role changes in the domain audit transaction", async () => {
  const auth = createAuth(prisma);
  const organization = await prisma.organization.findUniqueOrThrow({
    where: { slug: "test" },
  });
  const owner = await prisma.user.findUniqueOrThrow({
    where: { email: "bootstrap@example.test" },
  });
  const memberUser = await prisma.user.findUniqueOrThrow({
    where: { email: "member@example.test" },
  });
  const member = await prisma.member.findFirstOrThrow({
    where: { organizationId: organization.id, userId: memberUser.id },
  });
  await auth.api.requestPasswordReset({ body: { email: owner.email } });
  await auth.api.resetPassword({
    body: {
      token: resetDeliveries.get(owner.email)?.token ?? "",
      newPassword: "owner-test-password-long-enough",
    },
  });
  const login = await auth.api.signInEmail({
    body: { email: owner.email, password: "owner-test-password-long-enough" },
    asResponse: true,
  });
  const headers = new Headers({
    cookie: login.headers
      .getSetCookie()
      .map((cookie) => cookie.split(";")[0])
      .join("; "),
  });
  await prisma.$transaction(async (tx) => {
    await createAuth(tx).api.updateMemberRole({
      headers,
      body: {
        organizationId: organization.id,
        memberId: member.id,
        role: "admin",
      },
    });
    await tx.auditEvent.create({
      data: {
        id: randomUUID(),
        organizationId: organization.id,
        requestId: randomUUID(),
        authMethod: "cookie",
        ip: "127.0.0.1",
        transport: "web",
        action: "member.role",
        statusCode: 200,
        durationMs: 1,
        detail: { role: "admin" },
      },
    });
  });
  expect(
    (await prisma.member.findUniqueOrThrow({ where: { id: member.id } })).role,
  ).toBe("admin");
  await expect(
    prisma.$transaction(async (tx) => {
      await createAuth(tx).api.updateMemberRole({
        headers,
        body: {
          organizationId: organization.id,
          memberId: member.id,
          role: "member",
        },
      });
      await tx.auditEvent.create({
        data: {
          id: randomUUID(),
          organizationId: "missing-organization",
          requestId: randomUUID(),
          authMethod: "cookie",
          ip: "127.0.0.1",
          transport: "web",
          action: "member.role",
          statusCode: 200,
          durationMs: 1,
          detail: {},
        },
      });
    }),
  ).rejects.toMatchObject({ code: "P2003" });
  expect(
    (await prisma.member.findUniqueOrThrow({ where: { id: member.id } })).role,
  ).toBe("admin");
});

it("updates the configured member extension through Better Auth's adapter and revokes a key natively", async () => {
  const organization = await prisma.organization.findUniqueOrThrow({
    where: { slug: "test" },
  });
  const memberUser = await prisma.user.findUniqueOrThrow({
    where: { email: "member@example.test" },
  });
  const member = await prisma.member.findFirstOrThrow({
    where: { organizationId: organization.id, userId: memberUser.id },
  });
  await prisma.$transaction(async (tx) => {
    const auth = createAuth(tx);
    const context = await auth.$context;
    await context.adapter.update({
      model: "member",
      where: [
        { field: "id", value: member.id },
        { field: "organizationId", value: organization.id },
      ],
      update: { suspended: true },
    });
    await tx.auditEvent.create({
      data: {
        id: randomUUID(),
        organizationId: organization.id,
        requestId: randomUUID(),
        authMethod: "cookie",
        ip: "127.0.0.1",
        transport: "web",
        action: "member.suspend",
        statusCode: 200,
        durationMs: 1,
        detail: {},
      },
    });
  });
  expect(
    (await prisma.member.findUniqueOrThrow({ where: { id: member.id } }))
      .suspended,
  ).toBe(true);
  const owner = await prisma.member.findFirstOrThrow({
    where: { organizationId: organization.id, role: "owner" },
  });
  const auth = createAuth(prisma);
  const key = await auth.api.createApiKey({
    body: {
      organizationId: organization.id,
      userId: owner.userId,
      permissions: { sessions: ["read"] },
    },
  });
  await auth.api.updateApiKey({
    body: { keyId: key.id, userId: owner.userId, enabled: false },
  });
  expect((await auth.api.verifyApiKey({ body: { key: key.key } })).valid).toBe(
    false,
  );
  expect(
    (await prisma.apikey.findUniqueOrThrow({ where: { id: key.id } })).enabled,
  ).toBe(false);
});
