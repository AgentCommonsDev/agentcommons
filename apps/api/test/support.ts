import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { KeyPermissions } from "@agentcommons/core";
import { startDatabase as startControlDatabase } from "../../../packages/db/test/support.js";
import { cleanup } from "../../../scripts/cleanup.js";
import { AuthService } from "../src/services/auth.js";
import { MembershipService } from "../src/services/membership.js";
import { AuditService } from "../src/services/audit.js";
import { createPolicyCache } from "../src/services/policy-cache.js";
import { seedPolicies } from "../src/services/policies.js";
import { bootstrap, operatorContext } from "../src/auth/bootstrap.js";
import type { AuthConfiguration } from "../src/auth/config.js";
import type { BillingConfiguration } from "../src/repositories/billing.js";
import { requireCaller, type ServiceContext } from "../src/services/context.js";

export const testAccountPassword = "Integration native password 1234!";

export const testAuthConfiguration: AuthConfiguration = {
  publicUrl: "http://localhost:3000",
  secret: "integration-application-auth-secret-at-least-32-characters",
  emailPasswordEnabled: true,
  signupMode: "invite",
  allowedEmailDomains: [],
};

/**
 * The release list every integration file keeps: `defer` what you open, `release`
 * closes newest first and fails the hook when any release rejects.
 */
export function releaser() {
  const actions: Array<() => Promise<unknown>> = [];
  return {
    defer: (action: () => Promise<unknown>): void => {
      actions.unshift(action);
    },
    release: async (): Promise<void> => {
      const errors = await cleanup(actions.splice(0));
      if (errors.length)
        throw new AggregateError(
          errors,
          "Test resources failed to release cleanly.",
        );
    },
  };
}

/** The migrated control database from packages/db with the application's services on top. */
export async function startDatabase(
  authConfiguration: AuthConfiguration = testAuthConfiguration,
) {
  const database = await startControlDatabase();
  try {
    const policies = createPolicyCache(database.prisma);
    const audit = new AuditService(database.prisma, policies);
    const auth = new AuthService(database.prisma, authConfiguration, audit);
    return { ...database, policies, audit, auth, authConfiguration };
  } catch (error) {
    await database.close();
    throw error;
  }
}
export type TestDatabase = Awaited<ReturnType<typeof startDatabase>>;

/** The `cookie` request header carrying every cookie a Better Auth response set. */
export function cookieHeader(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
}
/** The single-use token at the end of a setup or reset link. */
export function setupToken(setupUrl: string | null): string {
  return z
    .string()
    .min(1)
    .parse(setupUrl ? new URL(setupUrl).pathname.split("/").at(-1) : null);
}
/** A ServiceContext authenticated from request headers, the way the adapters build one. */
export async function contextFor(
  database: TestDatabase,
  headers: Headers,
): Promise<ServiceContext> {
  const base = { ...operatorContext(), headers, ip: "127.0.0.1" };
  const principal = await database.auth.authenticate(headers, base);
  return { ...base, caller: principal.caller, principal };
}
/** Claims a setup or reset link with the account password. */
export async function claimSetup(
  database: TestDatabase,
  setupUrl: string | null,
  password = testAccountPassword,
): Promise<void> {
  await database.auth.native.api.resetPassword({
    body: { token: setupToken(setupUrl), newPassword: password },
  });
}
/** Signs in with the password and returns the cookie-authenticated context. */
export async function loginAs(
  database: TestDatabase,
  email: string,
  password = testAccountPassword,
): Promise<ServiceContext> {
  const signed = await database.auth.native.api.signInEmail({
    body: { email, password },
    asResponse: true,
  });
  if (signed.status !== 200)
    throw new Error(
      `Signing in ${email} failed with status ${String(signed.status)}.`,
    );
  return contextFor(database, new Headers({ cookie: cookieHeader(signed) }));
}
/** Flips the native `emailVerified` flag SaaS-mode gates read. */
export async function verifyEmail(
  database: TestDatabase,
  userId: string,
  verified = true,
): Promise<void> {
  await database.prisma.user.update({
    where: { id: userId },
    data: { emailVerified: verified },
  });
}

export async function provisionOrganization(
  database: TestDatabase,
  slug: string,
  options: { verified?: boolean; stripeCustomerId?: string } = {},
) {
  const email = `${slug}@example.com`;
  const value = await bootstrap(database.prisma, database.authConfiguration, {
    email,
    organization: slug,
    name: slug,
  });
  const access = await provisionAccess(
    database,
    email,
    z.string().parse(value.result.setup_url),
  );
  if (options.verified)
    await verifyEmail(database, requireCaller(access.owner).userId);
  if (options.stripeCustomerId)
    await database.prisma.organization.update({
      where: { id: value.result.organization_id },
      data: { stripeCustomerId: options.stripeCustomerId },
    });
  return access;
}

export async function provisionMember(
  database: TestDatabase,
  owner: ServiceContext,
  email: string,
  options: { verified?: boolean } = {},
) {
  const members = new MembershipService(
    database.prisma,
    database.authConfiguration,
    database.audit,
  );
  const value = await members.add(owner, { emails: [email], role: "member" });
  const access = await provisionAccess(
    database,
    email,
    z.string().parse(value.result.results[0]?.setup_url),
  );
  if (options.verified)
    await verifyEmail(database, requireCaller(access.owner).userId);
  return access;
}

async function provisionAccess(
  database: TestDatabase,
  email: string,
  setupUrl: string,
) {
  await claimSetup(database, setupUrl);
  const owner = await loginAs(database, email);
  const key = await database.auth.createKey(owner, {
    name: "Ingest integration",
    permissions: {
      sessions: ["ingest", "read"],
      ...(owner.caller?.role === "member" ? {} : { admin: ["*"] }),
    },
  });
  const context = await contextFor(
    database,
    new Headers({ authorization: `Bearer ${key.result.key}` }),
  );
  return { owner, context, key: key.result.key, email };
}

/** Headers of a context as the record `app.inject` takes, with the origin the CSRF check expects. */
export function injectHeaders(
  context: ServiceContext,
  extra: Record<string, string> = {},
): Record<string, string> {
  const result: Record<string, string> = {
    origin: testAuthConfiguration.publicUrl,
  };
  context.headers.forEach((value, key) => {
    result[key] = value;
  });
  return { ...result, ...extra };
}

/**
 * An organization with fixed identifiers written straight to the control tables, for
 * read-side tests that seed ClickHouse rows by hand: one admin member, one key, one
 * installation and the shipped policies. The user may already exist for another organization.
 */
export async function syntheticOrganization(
  database: TestDatabase,
  options: {
    organizationId: string;
    keyId: string;
    installationId: string;
    userId?: string;
    permissions?: KeyPermissions;
  },
): Promise<void> {
  const { organizationId, keyId, installationId } = options;
  const userId = options.userId ?? "owner";
  const now = new Date();
  await database.prisma.user.upsert({
    where: { id: userId },
    create: { id: userId, name: "Owner", email: `${userId}@example.test` },
    update: {},
  });
  await database.prisma.organization.create({
    data: {
      id: organizationId,
      name: organizationId,
      slug: organizationId,
      createdAt: now,
    },
  });
  await database.prisma.member.create({
    data: {
      id: `member-${organizationId}`,
      organizationId,
      userId,
      role: "admin",
      createdAt: now,
    },
  });
  await database.prisma.apikey.create({
    data: {
      id: keyId,
      referenceId: organizationId,
      key: `fixture-hash-${keyId}`,
      createdAt: now,
      updatedAt: now,
      permissions: JSON.stringify(
        options.permissions ?? { sessions: ["read"], admin: ["*"] },
      ),
    },
  });
  await database.prisma.apiKeyOwner.create({
    data: { keyId, organizationId, userId },
  });
  await seedPolicies(database.prisma, organizationId, userId);
  await database.prisma.installation.create({
    data: {
      organizationId,
      id: installationId,
      hostname: "test-host",
      osUser: "test-user",
      platform: "linux",
      arch: "x64",
    },
  });
}
/** A key-authenticated admin caller of a synthetic organization, bypassing authentication. */
export function syntheticContext(
  organizationId: string,
  options: { userId?: string; admin?: boolean; read?: boolean } = {},
): ServiceContext {
  return {
    caller: {
      organizationId,
      userId: options.userId ?? "owner",
      apiKeyId: null,
      role: "admin",
      authMethod: "key",
      permissions: {
        sessions: options.read === false ? [] : ["read"],
        ...(options.admin ? { admin: ["*"] } : {}),
      },
    },
    requestId: randomUUID(),
    transport: "rest",
    ip: "127.0.0.1",
    userAgent: "integration-test",
    startedAt: Date.now(),
    headers: new Headers(),
  };
}

/** The runtime billing configuration with test defaults; override only what a test varies. */
export function testBillingConfig(
  overrides: Partial<BillingConfiguration> = {},
): BillingConfiguration {
  return {
    mode: "customer",
    freeMonthlyRecords: 1000,
    proIncludedRecords: 10000,
    calComUrl: null,
    captureCentsPer1000: null,
    embeddingCentsPer1000: null,
    captureEventName: null,
    embeddingEventName: null,
    ...overrides,
  };
}
