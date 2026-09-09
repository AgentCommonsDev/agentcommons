import { startTraceDatabase } from "../../../packages/traces/test/support.js";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { mkdtemp, writeFile, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { z } from "zod";
import {
  cookieHeader,
  provisionOrganization,
  releaser,
  setupToken,
  testAuthConfiguration,
} from "./support.js";
import { startApp } from "./app.js";
import { AuthService } from "../src/services/auth.js";
import { MembershipService } from "../src/services/membership.js";
import { enrollDomain } from "../src/auth/domain.js";
import { bootstrap, operatorContext } from "../src/auth/bootstrap.js";
import { reauthorizeJob } from "../src/auth/jobs.js";
import { AuditService } from "../src/services/audit.js";
import type { AuthConfiguration } from "../src/auth/config.js";
import type { ServiceContext } from "../src/services/context.js";

let database: Awaited<ReturnType<typeof startTraceDatabase>>;
let owner: Awaited<ReturnType<typeof provisionOrganization>>;
let foreign: Awaited<ReturnType<typeof provisionOrganization>>;
let service: AuthService;
let members: MembershipService;
let signing: Awaited<ReturnType<typeof generateKeyPair>>;
const configuration: AuthConfiguration = {
  ...testAuthConfiguration,
  signupMode: "open",
  allowedEmailDomains: ["example.com"],
  socialProviders: {
    google: {
      clientId: "google-test-client",
      clientSecret: "google-test-secret",
    },
  },
};
const { defer, release } = releaser();
const nativeFetch = globalThis.fetch;
const tokens = new Map<string, string>();
beforeAll(async () => {
  database = await startTraceDatabase(configuration);
  defer(() => database.close());
  owner = await provisionOrganization(database, "domain-primary");
  foreign = await provisionOrganization(database, "domain-foreign");
  service = database.auth;
  members = new MembershipService(
    database.prisma,
    configuration,
    database.audit,
  );
  signing = await generateKeyPair("RS256", { extractable: true });
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(release);
const input = { organization: "domain-primary", domain: "example.com" };

/** A Google sign-in with a signed id token, against `service` unless another is given. */
async function google(
  email: string,
  {
    verified = true,
    service: selectedService = service,
    name: displayName = email,
    beforeCallback,
  }: {
    verified?: boolean;
    service?: AuthService;
    name?: string;
    beforeCallback?: () => void;
  } = {},
) {
  const started = await selectedService.handle(
    new Request(`${configuration.publicUrl}/auth/sign-in/social`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: configuration.publicUrl,
      },
      body: JSON.stringify({
        provider: "google",
        callbackURL: configuration.publicUrl,
      }),
    }),
    operatorContext(),
  );
  const start = z.object({ url: z.url() }).parse(await started.result.json());
  const authorization = new URL(start.url);
  const state = z.string().parse(authorization.searchParams.get("state"));
  const code = crypto.randomUUID();
  const nonce = authorization.searchParams.get("nonce");
  const token = await new SignJWT({
    email,
    email_verified: verified,
    name: displayName,
    ...(nonce ? { nonce } : {}),
  })
    .setProtectedHeader({ alg: "RS256", kid: "domain-test-key" })
    .setIssuer("https://accounts.google.com")
    .setAudience("google-test-client")
    .setSubject(email)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(signing.privateKey);
  tokens.set(code, token);
  const publicKey = {
    ...(await exportJWK(signing.publicKey)),
    alg: "RS256",
    use: "sig",
    kid: "domain-test-key",
  };
  vi.spyOn(globalThis, "fetch").mockImplementation(async (resource, init) => {
    const url =
      typeof resource === "string"
        ? resource
        : resource instanceof URL
          ? resource.href
          : resource.url;
    if (url === "https://oauth2.googleapis.com/token") {
      const body =
        init?.body instanceof URLSearchParams
          ? init.body
          : new URLSearchParams(z.string().parse(init?.body));
      const idToken = tokens.get(body.get("code") ?? "");
      if (!idToken)
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      tokens.delete(body.get("code") ?? "");
      return Response.json({
        access_token: "domain-token",
        token_type: "Bearer",
        expires_in: 300,
        id_token: idToken,
      });
    }
    if (url === "https://www.googleapis.com/oauth2/v3/certs")
      return Response.json({ keys: [publicKey] });
    return nativeFetch(resource, init);
  });
  beforeCallback?.();
  const response = (
    await selectedService.handle(
      new Request(
        `${configuration.publicUrl}/auth/callback/google?code=${code}&state=${encodeURIComponent(state)}`,
        { headers: { cookie: cookieHeader(started.result) } },
      ),
      operatorContext(),
    )
  ).result;
  return { response, headers: new Headers({ cookie: cookieHeader(response) }) };
}

// @req R-ORG-11 @req R-AUD-01
it("allows a domain only through native owner authentication, admits it immediately without a DNS proof, and retries idempotently", async () => {
  await expect(
    enrollDomain(database.prisma, configuration, operatorContext(), input),
  ).rejects.toBeDefined();
  await expect(
    enrollDomain(
      database.prisma,
      configuration,
      {
        ...owner.context,
        headers: new Headers({ authorization: `Bearer ${owner.key}` }),
      },
      input,
    ),
  ).rejects.toMatchObject({ code: "COOKIE_REQUIRED" });
  await expect(
    enrollDomain(database.prisma, configuration, foreign.owner, input),
  ).rejects.toMatchObject({ code: "ADMIN_REQUIRED" });
  const first = await enrollDomain(
    database.prisma,
    configuration,
    owner.owner,
    input,
  );
  expect(first.result).toMatchObject({ domain: input.domain, verified: true });
  expect(first.result).not.toHaveProperty("dns_record");
  const again = await enrollDomain(
    database.prisma,
    configuration,
    owner.owner,
    input,
  );
  expect(again.result).toEqual(first.result);
  expect(await database.prisma.ssoProvider.count()).toBe(1);
  expect(
    await database.prisma.ssoProvider.findUnique({
      where: { providerId: first.result.provider_id },
    }),
  ).toMatchObject({
    oidcConfig: null,
    samlConfig: null,
    domainVerified: true,
  });
  expect(
    (
      await database.prisma.auditEvent.findFirstOrThrow({
        where: { action: "operator.domain.register", statusCode: 200 },
        orderBy: { ts: "desc" },
      })
    ).organizationId,
  ).toBe(owner.context.caller?.organizationId);
});

// @req R-ORG-11 @req R-ORG-04
it("admits only verified Google identities and preserves durable removal, suspension, explicit restoration, and key/job boundaries", async () => {
  const login = await google("enrolled@example.com");
  const identity = await service.authenticate(login.headers, operatorContext());
  expect(identity.caller).toMatchObject({
    organizationId: owner.context.caller?.organizationId,
    role: "member",
  });
  const context: ServiceContext = {
    ...operatorContext(),
    caller: identity.caller,
    headers: login.headers,
  };
  const key = await service.createKey(context, {
    name: "enrolled user",
    permissions: { sessions: ["read"] },
  });
  const keyHeaders = new Headers({ authorization: `Bearer ${key.result.key}` });
  const keyIdentity = await service.authenticate(keyHeaders, operatorContext());
  const member = await database.prisma.member.findFirstOrThrow({
    where: {
      userId: identity.user.id,
      organizationId: z.string().parse(owner.context.caller?.organizationId),
    },
  });
  await members.remove(owner.owner, member.id, { reason: "Remove access" });
  const removed = await database.prisma.member.findUniqueOrThrow({
    where: { id: member.id },
  });
  expect(removed.suspended).toBe(true);
  expect(removed.removedAt).toBeInstanceOf(Date);
  expect(
    (
      await members.list(owner.owner, {
        filters: { email: identity.user.email },
      })
    ).result.items,
  ).toEqual([]);
  expect((await service.organizations(context)).result.organizations).toEqual(
    [],
  );
  await expect(
    service.authenticate(keyHeaders, operatorContext()),
  ).rejects.toMatchObject({ code: "MEMBERSHIP_REQUIRED" });
  await expect(
    reauthorizeJob(
      database.prisma,
      { ...context, caller: keyIdentity.caller },
      configuration,
    ),
  ).rejects.toMatchObject({ code: "MEMBERSHIP_REQUIRED" });
  const repeated = await google(identity.user.email);
  expect(
    (await service.authenticate(repeated.headers, operatorContext())).caller,
  ).toBeNull();
  await members.add(owner.owner, {
    emails: [identity.user.email],
    role: "member",
  });
  expect(
    await database.prisma.member.findUnique({ where: { id: member.id } }),
  ).toMatchObject({ suspended: false, removedAt: null, role: "member" });
  expect(
    (await service.authenticate(keyHeaders, operatorContext())).caller?.role,
  ).toBe("member");
  await members.suspend(owner.owner, member.id, {
    suspended: true,
    reason: "Suspend access",
  });
  const suspended = await google(identity.user.email);
  expect(
    (await service.authenticate(suspended.headers, operatorContext())).caller,
  ).toBeNull();
  expect(
    (
      await database.prisma.member.findUniqueOrThrow({
        where: { id: member.id },
      })
    ).removedAt,
  ).toBeNull();
  for (const [email, verified] of [
    ["unverified@example.com", false],
    ["outsider@elsewhere.test", true],
  ] as const) {
    const rejected = await google(email, { verified });
    expect(rejected.response.headers.get("location")).toContain("error=");
    expect(
      await database.prisma.user.findUnique({ where: { email } }),
    ).toBeNull();
  }
});

// @req R-ORG-11 @req R-AUD-01
it("rolls back native registration and callback membership when the audit fails", async () => {
  const config = {
    ...configuration,
    allowedEmailDomains: ["example.com", "example.net"],
  };
  const before = await database.prisma.verification.count();
  vi.spyOn(AuditService.prototype, "write").mockRejectedValueOnce(
    new Error("injected domain audit failure"),
  );
  await expect(
    enrollDomain(database.prisma, config, owner.owner, {
      ...input,
      domain: "example.net",
    }),
  ).rejects.toBeDefined();
  expect(
    await database.prisma.ssoProvider.count({
      where: { domain: "example.net" },
    }),
  ).toBe(0);
  expect(await database.prisma.verification.count()).toBe(before);
  await expect(
    google("audit-rollback@example.com", {
      beforeCallback: () => {
        vi.spyOn(AuditService.prototype, "write").mockRejectedValueOnce(
          new Error("injected callback audit failure"),
        );
      },
    }),
  ).rejects.toBeDefined();
  expect(
    await database.prisma.user.findUnique({
      where: { email: "audit-rollback@example.com" },
    }),
  ).toBeNull();
  const existing = await google(owner.email);
  expect(
    (await service.authenticate(existing.headers, operatorContext())).caller
      ?.role,
  ).toBe("owner");
});

// @req R-ORG-11
it("runs the operator CLI with a private real cookie file and rejects permissive file modes without exposing cookies", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agentcommons-domain-cli-"));
  defer(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "owner.cookie");
  const cookie = z.string().parse(owner.owner.headers.get("cookie"));
  await writeFile(file, cookie, { mode: 0o600 });
  const args = [
    "db:domain",
    "--organization",
    input.organization,
    "--domain",
    input.domain,
    "--cookie-file",
    file,
  ];
  const env = {
    ...process.env,
    PUBLIC_URL: configuration.publicUrl,
    DATABASE_URL: database.urls.app,
    BETTER_AUTH_SECRET: configuration.secret,
    AUTH_EMAIL_PASSWORD_ENABLED: "true",
    AUTH_SIGNUP_MODE: "open",
    AUTH_ALLOWED_EMAIL_DOMAINS: "example.com",
    AUTH_SOCIAL_PROVIDER: "google",
    AUTH_GOOGLE_CLIENT_ID: "google-test-client",
    AUTH_GOOGLE_CLIENT_SECRET: "google-test-secret",
    AUTH_OIDC_ISSUER: "",
    AUTH_OIDC_CLIENT_ID: "",
    AUTH_OIDC_CLIENT_SECRET: "",
  };
  const result = await promisify(execFile)("pnpm", args, {
    cwd: new URL("../../../", import.meta.url),
    env,
  });
  expect(result.stdout).toContain('"verified":true');
  expect(result.stdout + result.stderr).not.toContain(cookie);
  await chmod(file, 0o644);
  await expect(
    promisify(execFile)("pnpm", args, {
      cwd: new URL("../../../", import.meta.url),
      env,
    }),
  ).rejects.toThrow("private cookie file");
});

// @req R-ORG-11
it("refuses ambiguous verified domains and non-Google configuration without changing existing roles", async () => {
  await enrollDomain(database.prisma, configuration, foreign.owner, {
    ...input,
    organization: "domain-foreign",
  });
  const ambiguous = await google("ambiguous@example.com");
  expect(
    (await service.authenticate(ambiguous.headers, operatorContext())).caller,
  ).toBeNull();
  const user = await database.prisma.user.findUniqueOrThrow({
    where: { email: "ambiguous@example.com" },
  });
  expect(
    await database.prisma.member.count({ where: { userId: user.id } }),
  ).toBe(0);
  await expect(
    enrollDomain(
      database.prisma,
      {
        ...configuration,
        socialProviders: {
          github: { clientId: "other", clientSecret: "other" },
        },
      },
      owner.owner,
      input,
    ),
  ).rejects.toMatchObject({ code: "DOMAIN_ENROLLMENT_DISABLED" });
  const existing = await google(owner.email);
  expect(
    (await service.authenticate(existing.headers, operatorContext())).caller
      ?.role,
  ).toBe("owner");
});

// @req R-ORG-11 @req R-ORG-03
it("invalidates initial setup on removal before an unclaimed identity joins another organization", async () => {
  const created = await members.add(owner.owner, {
    emails: ["removed-placeholder@example.com"],
    role: "member",
  });
  const first = z
    .object({ user_id: z.string(), setup_url: z.url() })
    .parse(created.result.results[0]);
  const row = await database.prisma.member.findFirstOrThrow({
    where: { userId: first.user_id },
  });
  await members.remove(owner.owner, row.id, {
    reason: "Remove unclaimed access",
  });
  await members.add(foreign.owner, {
    emails: ["removed-placeholder@example.com"],
    role: "member",
  });
  const oldToken = setupToken(first.setup_url);
  await expect(
    service.native.api.resetPassword({
      body: {
        token: oldToken,
        newPassword: "Old administrator credential 1234!",
      },
    }),
  ).rejects.toBeDefined();
  expect(
    await database.prisma.account.count({ where: { userId: first.user_id } }),
  ).toBe(0);
  const fresh = await members.passwordSetup(foreign.owner, first.user_id);
  const freshToken = setupToken(fresh.result.setup_url);
  await service.native.api.resetPassword({
    body: {
      token: freshToken,
      newPassword: "Current administrator credential 1234!",
    },
  });
  expect(
    await database.prisma.account.count({ where: { userId: first.user_id } }),
  ).toBe(1);
});

// @req R-SAAS-01 @req R-SAAS-02
it("refuses Google implicit linking to an unverified public password preclaim and permits verified placeholder recovery", async () => {
  const links = new Map<string, string>();
  const saas = new AuthService(
    database.prisma,
    {
      ...configuration,
      instanceMode: "saas",
      mail: {
        send: (value) => {
          links.set(`${value.kind}:${value.to}`, value.url);
          return Promise.resolve();
        },
      },
    },
    database.audit,
  );
  const request = (path: string, body: object) =>
    saas.handle(
      new Request(`${configuration.publicUrl}/auth/${path}`, {
        method: "POST",
        headers: {
          origin: configuration.publicUrl,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      }),
      operatorContext(),
    );
  const email = `preclaimed-${crypto.randomUUID()}@example.com`;
  await request("sign-up/email", {
    email,
    name: "Unverified preclaim",
    password: "Unverified claimant password 1234!",
  });
  const rejected = await google(email, { service: saas });
  expect(rejected.response.headers.get("location")).toContain(
    "account_not_linked",
  );
  const user = await database.prisma.user.findUniqueOrThrow({
    where: { email },
  });
  expect(user.emailVerified).toBe(false);
  expect(
    await database.prisma.account.count({
      where: { userId: user.id, providerId: "google" },
    }),
  ).toBe(0);
  expect(
    await database.prisma.member.count({ where: { userId: user.id } }),
  ).toBe(0);
  const placeholderEmail = `placeholder-${crypto.randomUUID()}@example.com`;
  const placeholder = await database.auth.native.api.createUser({
    body: { email: placeholderEmail, name: "Invited placeholder" },
  });
  expect(
    (await google(placeholderEmail, { service: saas })).response.headers.get(
      "location",
    ),
  ).toContain("account_not_linked");
  await request("send-verification-email", {
    email: placeholderEmail,
    callbackURL: configuration.publicUrl,
  });
  const url = z.string().parse(links.get(`verification:${placeholderEmail}`));
  const verified = await saas.handle(new Request(url), operatorContext());
  expect(verified.result.status).toBe(302);
  expect(
    (
      await database.prisma.user.findUniqueOrThrow({
        where: { id: placeholder.user.id },
      })
    ).emailVerified,
  ).toBe(true);
  const linked = await google(placeholderEmail, { service: saas });
  expect(linked.response.headers.get("location")).not.toContain("error=");
  expect(
    await database.prisma.account.count({
      where: { userId: placeholder.user.id, providerId: "google" },
    }),
  ).toBe(1);
});

// @req R-RED-01 @req R-SAAS-01
it("redacts native provider and profile names while preserving customer identity and bootstrap behavior", async () => {
  const secret = "ghp_" + "a".repeat(36);
  const email = `profile-${crypto.randomUUID()}@example.com`;
  const signed = await google(email, { name: `Provider ${secret}` });
  const user = await database.prisma.user.findUniqueOrThrow({
    where: { email },
  });
  expect(user.email).toBe(email);
  expect(user.name).not.toContain(secret);
  expect(user.name).toContain("REDACTED");
  const before = await database.prisma.account.findMany({
    where: { userId: user.id },
  });
  await service.native.api.updateUser({
    headers: signed.headers,
    body: { name: `Updated ${secret}` },
  });
  expect(
    (await database.prisma.user.findUniqueOrThrow({ where: { id: user.id } }))
      .name,
  ).not.toContain(secret);
  expect(
    await database.prisma.account.findMany({ where: { userId: user.id } }),
  ).toEqual(before);
  const customer = await bootstrap(database.prisma, configuration, {
    email: `bootstrap-${crypto.randomUUID()}@example.com`,
    organization: `profile-${crypto.randomUUID()}`,
    name: `Customer ${secret}`,
  });
  expect(
    (
      await database.prisma.organization.findUniqueOrThrow({
        where: { id: customer.result.organization_id },
      })
    ).name,
  ).not.toContain(secret);
  expect(customer.result.setup_url).toContain("/auth/reset-password/");
});

// @req R-ORG-11 @req R-AUD-01
it("lets organization administrators manage native domain access under invite while closed and operator restrictions remain enforced", async () => {
  const inviteConfiguration: AuthConfiguration = {
    ...configuration,
    signupMode: "invite",
    allowedEmailDomains: [],
  };
  const invite = new AuthService(
    database.prisma,
    inviteConfiguration,
    database.audit,
  );
  const domain = "invite-members.example.org";
  const denied = await google(`early@${domain}`, { service: invite });
  expect(denied.response.headers.get("location")).toContain(
    "account_not_provisioned",
  );
  expect(
    await database.prisma.user.count({ where: { email: `early@${domain}` } }),
  ).toBe(0);
  const allowed = await invite.domain(owner.owner, { domain });
  expect(allowed.result.verified).toBe(true);
  const admitted = await google(`member@${domain}`, { service: invite });
  const identity = await invite.authenticate(
    admitted.headers,
    operatorContext(),
  );
  expect(
    await database.prisma.member.findFirst({
      where: {
        userId: identity.user.id,
        organizationId: z.string().parse(owner.owner.caller?.organizationId),
      },
    }),
  ).toMatchObject({ role: "member", suspended: false, removedAt: null });
  const listing = await invite.domains(owner.owner, { domain, limit: 1 });
  expect(listing.result.items.map((row) => row.domain)).toEqual([domain]);
  expect(listing.result.enabled).toBe(true);
  expect(listing.audit.organizationId).toBe(owner.owner.caller?.organizationId);
  expect(
    (await invite.domains(foreign.owner, { domain })).result.items,
  ).toEqual([]);
  const keyContext = {
    ...owner.context,
    headers: new Headers({ authorization: `Bearer ${owner.key}` }),
  };
  await expect(invite.domain(keyContext, { domain })).rejects.toMatchObject({
    code: "COOKIE_REQUIRED",
  });
  const unverified = await google(`unverified@${domain}`, {
    verified: false,
    service: invite,
  });
  expect(unverified.response.headers.get("location")).toContain(
    "provider_email_unverified",
  );
  const subdomain = await google(`member@sub.${domain}`, { service: invite });
  expect(subdomain.response.headers.get("location")).toContain(
    "account_not_provisioned",
  );
  const closed = new AuthService(
    database.prisma,
    { ...inviteConfiguration, signupMode: "closed" },
    database.audit,
  );
  expect(
    (
      await google(`closed@${domain}`, { service: closed })
    ).response.headers.get("location"),
  ).toContain("account_not_provisioned");
  expect((await closed.domains(owner.owner, {})).result.enabled).toBe(false);
  await expect(closed.domain(owner.owner, { domain })).rejects.toMatchObject({
    code: "DOMAIN_ENROLLMENT_DISABLED",
  });
  const restricted = new AuthService(
    database.prisma,
    { ...inviteConfiguration, allowedEmailDomains: ["example.com"] },
    database.audit,
  );
  expect(
    (
      await google(`restricted@${domain}`, { service: restricted })
    ).response.headers.get("location"),
  ).toContain("email_domain_not_allowed");
  await expect(
    restricted.domain(owner.owner, { domain }),
  ).rejects.toMatchObject({ code: "DOMAIN_ENROLLMENT_DISABLED" });
  expect(
    await database.prisma.auditEvent.count({
      where: {
        action: "operator.domain.register",
        statusCode: { gte: 400 },
        organizationId: z.string().parse(owner.owner.caller?.organizationId),
      },
    }),
  ).toBeGreaterThan(0);
});

// @req R-ORG-11 @req R-DASH-29 @req R-AUD-01
it("serves scoped domain allowlisting through generated REST routes with bounded domain pagination", async () => {
  const { app, close } = await startApp(database, {
    AUTH_SOCIAL_PROVIDER: "google",
    AUTH_GOOGLE_CLIENT_ID: "google-test-client",
    AUTH_GOOGLE_CLIENT_SECRET: "google-test-secret",
    AUTH_SIGNUP_MODE: "invite",
  });
  try {
    const headers = {
      cookie: z.string().parse(owner.owner.headers.get("cookie")),
      origin: configuration.publicUrl,
    };
    const domain = "rest-domain.example.org";
    const before = await database.prisma.auditEvent.count();
    const registered = await app.inject({
      method: "POST",
      url: "/api/v1/admin/domains",
      headers,
      payload: { domain },
    });
    expect(registered.statusCode, registered.body).toBe(200);
    expect(await database.prisma.auditEvent.count()).toBe(before + 1);
    expect(registered.json<unknown>()).toMatchObject({
      domain,
      verified: true,
    });
    const gone = await app.inject({
      method: "POST",
      url: "/api/v1/admin/domains/verify",
      headers,
      payload: { domain },
    });
    expect(gone.statusCode).toBe(404);
    const listed = await app.inject({
      method: "GET",
      url: "/api/v1/admin/domains?limit=1&sort=domain&order=asc",
      headers,
    });
    expect(listed.statusCode, listed.body).toBe(200);
    const page = z
      .object({
        items: z.array(z.object({ domain: z.string() })),
        cursor: z.string(),
      })
      .parse(listed.json<unknown>());
    expect(page.items).toHaveLength(1);
    const next = await app.inject({
      method: "GET",
      url: `/api/v1/admin/domains?limit=1&sort=domain&order=asc&cursor=${encodeURIComponent(page.cursor)}`,
      headers,
    });
    expect(next.statusCode, next.body).toBe(200);
    expect(
      z
        .object({ items: z.array(z.object({ domain: z.string() })) })
        .parse(next.json<unknown>()).items[0]?.domain,
    ).not.toBe(page.items[0]?.domain);
    const foreignPage = await app.inject({
      method: "GET",
      url: `/api/v1/admin/domains?limit=1&sort=domain&order=asc&cursor=${encodeURIComponent(page.cursor)}`,
      headers: {
        cookie: z.string().parse(foreign.owner.headers.get("cookie")),
      },
    });
    expect(foreignPage.statusCode).toBe(400);
    const keyWrite = await app.inject({
      method: "POST",
      url: "/api/v1/admin/domains",
      headers: { authorization: `Bearer ${owner.key}` },
      payload: { domain },
    });
    expect(keyWrite.statusCode).toBe(403);
    const invalidDomain = await app.inject({
      method: "POST",
      url: "/api/v1/admin/domains",
      headers,
      payload: { domain: "https://example.org" },
    });
    expect(invalidDomain.statusCode).toBe(400);
  } finally {
    await close();
  }
});

// @req R-ORG-11
it("filters domains literally and sorts them on the server", async () => {
  const domains = new AuthService(
    database.prisma,
    { ...configuration, allowedEmailDomains: [] },
    database.audit,
  );
  await domains.domain(owner.owner, { domain: "alpha-filter.example.org" });
  await domains.domain(owner.owner, { domain: "beta-filter.example.org" });
  const filtered = await domains.domains(owner.owner, {
    domain: "alpha-filter",
  });
  expect(filtered.result.items).toHaveLength(1);
  expect(filtered.result.items[0]).toMatchObject({
    domain: "alpha-filter.example.org",
    verified: true,
  });
  for (const domain of ["%", "_", "\\"])
    expect(
      (await domains.domains(owner.owner, { domain })).result.items,
    ).toEqual([]);
  const ascending = (
    await domains.domains(owner.owner, { domain: "-filter", order: "asc" })
  ).result.items.map((row) => row.domain);
  const descending = (
    await domains.domains(owner.owner, { domain: "-filter", order: "desc" })
  ).result.items.map((row) => row.domain);
  expect(ascending).toEqual([...descending].reverse());
  expect(ascending[0]).toBe("alpha-filter.example.org");
});

// @req R-ORG-11
it("keeps the native Google-only eligibility predicate consistent for mixed provider configurations", async () => {
  const config: AuthConfiguration = {
    ...configuration,
    signupMode: "invite",
    allowedEmailDomains: [],
    socialProviders: {
      ...configuration.socialProviders,
      github: { clientId: "mixed-fixture", clientSecret: "mixed-fixture" },
    },
  };
  const mixed = new AuthService(database.prisma, config, database.audit);
  expect((await mixed.domains(owner.owner, {})).result.enabled).toBe(false);
  await expect(
    mixed.domain(owner.owner, { domain: "mixed.example.org" }),
  ).rejects.toMatchObject({ code: "DOMAIN_ENROLLMENT_DISABLED" });
  const signed = await google("mixed-provider@invite-members.example.org", {
    service: mixed,
  });
  expect(signed.response.headers.get("location")).toContain(
    "account_not_provisioned",
  );
  expect(
    await database.prisma.user.count({
      where: { email: "mixed-provider@invite-members.example.org" },
    }),
  ).toBe(0);
});
