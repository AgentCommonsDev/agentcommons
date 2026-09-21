import { afterAll, beforeAll, expect, it } from "vitest";
import {
  provisionMember,
  provisionOrganization,
  releaser,
  startDatabase,
  testAuthConfiguration,
  type TestDatabase,
} from "./support.js";
import { operatorContext } from "../src/auth/bootstrap.js";
import { requireCaller } from "../src/services/context.js";
import { enrollDomain } from "../src/auth/domain.js";
import { AuthService } from "../src/services/auth.js";
import { MembershipService } from "../src/services/membership.js";
import { OrganizationSsoService } from "../src/services/organization-sso.js";
import type { AuthConfiguration } from "../src/auth/config.js";

// Google is the sole provider so domains can be enrolled; email/password is on so the gate
// is armed; empty allowedEmailDomains lets any test domain enroll (customer mode).
const configuration: AuthConfiguration = {
  ...testAuthConfiguration,
  signupMode: "open",
  allowedEmailDomains: [],
  socialProviders: {
    google: {
      clientId: "google-test-client",
      clientSecret: "google-test-secret",
    },
  },
};
const { defer, release } = releaser();
let database: TestDatabase;
let sso: OrganizationSsoService;
let members: MembershipService;
// sign-up/email and request-password-reset are SaaS-only routes; this service reads the
// same tables and exercises them without provisioning in SaaS mode.
let saasService: AuthService;
let enforcing: Awaited<ReturnType<typeof provisionOrganization>>;
let open: Awaited<ReturnType<typeof provisionOrganization>>;

/** A credential request the way the transport adapter builds one, aimed at `service`. */
function credential(
  path: string,
  body: Record<string, unknown>,
  service: AuthService = database.auth,
) {
  return service.handle(
    new Request(`${configuration.publicUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: configuration.publicUrl,
      },
      body: JSON.stringify(body),
    }),
    operatorContext(),
  );
}

beforeAll(async () => {
  database = await startDatabase(configuration);
  defer(() => database.close());
  sso = new OrganizationSsoService({
    prisma: database.prisma,
    audit: database.audit,
  });
  members = new MembershipService(
    database.prisma,
    configuration,
    database.audit,
  );
  saasService = new AuthService(
    database.prisma,
    { ...configuration, instanceMode: "saas", signupMode: "open" },
    database.audit,
  );
  // One organization that requires SSO (domain acme.test) and one that does not (beta.test).
  enforcing = await provisionOrganization(database, "sso-enforcing");
  open = await provisionOrganization(database, "sso-open");
  await enrollDomain(database.prisma, configuration, enforcing.owner, {
    organization: "sso-enforcing",
    domain: "acme.test",
  });
  await enrollDomain(database.prisma, configuration, open.owner, {
    organization: "sso-open",
    domain: "beta.test",
  });
  const set = await sso.set(enforcing.owner, { sso_only: true });
  expect(set.result).toEqual({ sso_only: true, revision: 1 });
});
afterAll(release);

// @req R-AUTH-07 @req R-AUTH-01 @req R-ORG-11
it("refuses password credentials for an ssoOnly domain on every credential path, before native auth", async () => {
  // sign-in for the ssoOnly domain is refused with the exact code the login page keys off.
  await expect(
    credential("/auth/sign-in/email", {
      email: "person@acme.test",
      password: "Integration native password 1234!",
    }),
  ).rejects.toMatchObject({ statusCode: 403, code: "SSO_REQUIRED" });

  // A domain enrolled to a non-ssoOnly organization is left to native auth: no account
  // exists, so the outcome is a native 400/401 — never our 403. The difference from the
  // ssoOnly domain (identical: no account) proves the gate runs before native.handler and
  // cannot be bypassed by calling /auth/* directly.
  const openSignin = await credential("/auth/sign-in/email", {
    email: "person@beta.test",
    password: "Integration native password 1234!",
  });
  expect(openSignin.result.status).not.toBe(403);
  expect([400, 401]).toContain(openSignin.result.status);

  // A domain enrolled to no organization is likewise left to native auth.
  const unenrolled = await credential("/auth/sign-in/email", {
    email: "person@nowhere.test",
    password: "Integration native password 1234!",
  });
  expect(unenrolled.result.status).not.toBe(403);

  // Sign-up and password-reset requests (SaaS-only routes) are refused too.
  await expect(
    credential(
      "/auth/sign-up/email",
      {
        email: "newcomer@acme.test",
        password: "Integration native password 1234!",
        name: "Newcomer",
      },
      saasService,
    ),
  ).rejects.toMatchObject({ statusCode: 403, code: "SSO_REQUIRED" });
  await expect(
    credential(
      "/auth/request-password-reset",
      { email: "person@acme.test", redirectTo: configuration.publicUrl },
      saasService,
    ),
  ).rejects.toMatchObject({ statusCode: 403, code: "SSO_REQUIRED" });
  // A sign-up on a non-ssoOnly domain is not refused by the gate.
  const openSignup = await credential(
    "/auth/sign-up/email",
    {
      email: "fresh@beta.test",
      password: "Integration native password 1234!",
      name: "Fresh",
    },
    saasService,
  );
  expect(openSignup.result.status).not.toBe(403);

  // The refusal is recorded as an audit row on a credential action.
  const audited = await database.prisma.auditEvent.findFirst({
    where: { statusCode: 403, action: { startsWith: "auth." } },
    orderBy: { ts: "desc" },
  });
  expect(audited).not.toBeNull();
});

// @req R-AUTH-07
it("forces SSO by the email's domain regardless of the user's other memberships", async () => {
  // A user on the ssoOnly domain is also a member of the non-ssoOnly organization.
  await members.add(open.owner, {
    emails: ["shared@acme.test"],
    role: "member",
  });
  await expect(
    credential("/auth/sign-in/email", {
      email: "shared@acme.test",
      password: "Integration native password 1234!",
    }),
  ).rejects.toMatchObject({ statusCode: 403, code: "SSO_REQUIRED" });
});

// @req R-AUTH-07
it("stays dormant when instance email/password is disabled", async () => {
  const passwordDisabled = new AuthService(
    database.prisma,
    { ...configuration, emailPasswordEnabled: false },
    database.audit,
  );
  const response = await credential(
    "/auth/sign-in/email",
    {
      email: "person@acme.test",
      password: "Integration native password 1234!",
    },
    passwordDisabled,
  );
  // Native auth answers (credentials disabled); the SSO gate does not fire.
  expect(response.result.status).not.toBe(403);
});

// @req R-AUTH-07 @req R-AUTH-03
it("issues no password setup link when a new member's domain requires SSO", async () => {
  const enforced = await members.add(enforcing.owner, {
    emails: ["hire@acme.test"],
    role: "member",
  });
  expect(enforced.result.results[0]).toMatchObject({
    status: "added",
    setup_url: null,
  });
  const openAdd = await members.add(open.owner, {
    emails: ["hire@beta.test"],
    role: "member",
  });
  expect(typeof openAdd.result.results[0]?.setup_url).toBe("string");
});

// @req R-AUTH-07
it("reads and writes ssoOnly only for effective admins, versioning and auditing the change", async () => {
  // A member cannot read or write the policy.
  const member = await provisionMember(
    database,
    open.owner,
    "reader@beta.test",
  );
  await expect(sso.get(member.owner)).rejects.toMatchObject({
    statusCode: 403,
    code: "FORBIDDEN",
  });
  await expect(sso.set(member.owner, { sso_only: true })).rejects.toMatchObject(
    { statusCode: 403, code: "FORBIDDEN" },
  );

  // An admin reads the current state.
  const current = await sso.get(enforcing.owner);
  expect(current.result).toEqual({ sso_only: true, revision: 1 });

  // Setting the same value does not move the revision.
  const unchanged = await sso.set(enforcing.owner, { sso_only: true });
  expect(unchanged.result).toEqual({ sso_only: true, revision: 1 });

  // A real change increments the dedicated revision and is audited.
  const changed = await sso.set(enforcing.owner, { sso_only: false });
  expect(changed.result).toEqual({ sso_only: false, revision: 2 });
  const organizationId = requireCaller(enforcing.context).organizationId;
  const audit = await database.prisma.auditEvent.findFirst({
    where: { action: "organization.sso.update", organizationId },
    orderBy: { ts: "desc" },
  });
  expect(audit).not.toBeNull();

  // The embeddings epoch is untouched by SSO changes.
  const settings = await database.prisma.organizationSettings.findUnique({
    where: { organizationId },
    select: { revision: true, ssoRevision: true },
  });
  expect(settings).toMatchObject({ revision: 0, ssoRevision: 2 });

  // Turning SSO back off restores native password credentials for the domain.
  const restored = await credential("/auth/sign-in/email", {
    email: "person@acme.test",
    password: "Integration native password 1234!",
  });
  expect(restored.result.status).not.toBe(403);
});
