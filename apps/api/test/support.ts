import { cleanup as cleanupAll } from "../../../scripts/cleanup.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { PrismaClient } from "@agentcommons/db";
import { z } from "zod";
import { AuthService } from "../src/services/auth.js";
import { MembershipService } from "../src/services/membership.js";
import { AuditService } from "../src/services/audit.js";
import { createPolicyCache } from "../src/services/policy-cache.js";
import { bootstrap, operatorContext } from "../src/auth/bootstrap.js";
import type { AuthConfiguration } from "../src/auth/config.js";
import type { ServiceContext } from "../src/services/context.js";

export const testAccountPassword = "Integration native password 1234!";

export const testAuthConfiguration: AuthConfiguration = {
  publicUrl: "http://localhost:3000",
  secret: "integration-application-auth-secret-at-least-32-characters",
  emailPasswordEnabled: true,
  signupMode: "invite",
  allowedEmailDomains: [],
};

export async function startDatabase(
  authConfiguration: AuthConfiguration = testAuthConfiguration,
) {
  const container = await new PostgreSqlContainer("postgres:16").start();
  const release: Array<() => Promise<unknown>> = [() => container.stop()];
  try {
    const url = (role: string) => {
      const parsed = new URL(container.getConnectionUri());
      parsed.username = role;
      parsed.password = "test-database-password";
      return parsed.toString();
    };
    const urls = {
      app: url("ac_app"),
      migration: container.getConnectionUri(),
      traceControl: url("ac_trace_control"),
    };
    await promisify(execFile)("pnpm", ["migrate"], {
      cwd: new URL("../../../packages/db/", import.meta.url),
      env: {
        ...process.env,
        DATABASE_MIGRATION_URL: urls.migration,
        DATABASE_TRACE_CONTROL_URL: urls.traceControl,
        DATABASE_URL: urls.app,
      },
    });
    const prisma = new PrismaClient({ datasources: { db: { url: urls.app } } });
    release.unshift(() => prisma.$disconnect());
    const policies = createPolicyCache(prisma);
    const audit = new AuditService(prisma, policies);
    const auth = new AuthService(prisma, authConfiguration, audit);
    return {
      prisma,
      policies,
      audit,
      auth,
      authConfiguration,
      urls,
      async close() {
        const errors = await cleanupAll(release.splice(0));
        if (errors.length)
          throw new AggregateError(
            errors,
            "Integration database cleanup failed.",
          );
      },
    };
  } catch (error) {
    const errors = await cleanupAll(release.splice(0));
    if (errors.length)
      throw new AggregateError(
        [error, ...errors],
        "Integration database setup and cleanup failed.",
        { cause: error },
      );
    throw error;
  }
}

export async function provisionOrganization(
  database: Awaited<ReturnType<typeof startDatabase>>,
  slug: string,
) {
  const email = `${slug}@example.com`;
  const value = await bootstrap(database.prisma, database.authConfiguration, {
    email,
    organization: slug,
    name: slug,
  });
  const setupUrl = z.string().parse(value.result.setup_url);
  return provisionAccess(database, email, setupUrl);
}

export async function provisionMember(
  database: Awaited<ReturnType<typeof startDatabase>>,
  owner: ServiceContext,
  email: string,
) {
  const members = new MembershipService(
    database.prisma,
    database.authConfiguration,
    database.audit,
  );
  const value = await members.add(owner, { emails: [email], role: "member" });
  return provisionAccess(
    database,
    email,
    z.string().parse(value.result.results[0]?.setup_url),
  );
}

async function provisionAccess(
  database: Awaited<ReturnType<typeof startDatabase>>,
  email: string,
  setupUrl: string,
) {
  const token = z.string().parse(new URL(setupUrl).pathname.split("/").at(-1));
  const password = testAccountPassword;
  await database.auth.native.api.resetPassword({
    body: { token, newPassword: password },
  });
  const signed = await database.auth.native.api.signInEmail({
    body: { email, password },
    asResponse: true,
  });
  const headers = new Headers({
    cookie: signed.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; "),
  });
  const base = { ...operatorContext(), headers, ip: "127.0.0.1" };
  const owner: ServiceContext = {
    ...base,
    caller: (await database.auth.authenticate(headers, base)).caller,
  };
  const key = await database.auth.createKey(owner, {
    name: "Ingest integration",
    permissions: {
      sessions: ["ingest", "read"],
      ...(owner.caller?.role === "member" ? {} : { admin: ["*"] }),
    },
  });
  const keyHeaders = new Headers({ authorization: `Bearer ${key.result.key}` });
  const keyBase = {
    ...operatorContext(),
    headers: keyHeaders,
    ip: "127.0.0.1",
  };
  const context: ServiceContext = {
    ...keyBase,
    caller: (await database.auth.authenticate(keyHeaders, keyBase)).caller,
  };
  return { owner, context, key: key.result.key, email };
}
