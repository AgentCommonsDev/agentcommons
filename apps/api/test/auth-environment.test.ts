import { expect, it } from "vitest";
import { authEnvironment, publicUrlSchema } from "../src/auth/environment.js";
const baseline = {
  PUBLIC_URL: "https://sessions.example.test",
  DATABASE_URL: "postgresql://ac_app:password@localhost/agentcommons",
  BETTER_AUTH_SECRET: "environment-test-secret-at-least-32-characters",
};
// @req R-AUTH-01
it("parses native login environment with complete credentials and verified OIDC discovery", () => {
  expect(authEnvironment(baseline).auth).toMatchObject({
    emailPasswordEnabled: true,
    signupMode: "invite",
    allowedEmailDomains: [],
  });
  const social = authEnvironment({
    ...baseline,
    AUTH_SOCIAL_PROVIDER: "google",
    AUTH_GOOGLE_CLIENT_ID: "client",
    AUTH_GOOGLE_CLIENT_SECRET: "secret",
    AUTH_ALLOWED_EMAIL_DOMAINS: "EXAMPLE.TEST, other.test",
    AUTH_EMAIL_PASSWORD_ENABLED: "false",
  });
  expect(social.auth.socialProviders).toEqual({
    google: { clientId: "client", clientSecret: "secret" },
  });
  expect(social.auth.allowedEmailDomains).toEqual([
    "example.test",
    "other.test",
  ]);
  expect(social.auth.emailPasswordEnabled).toBe(false);
  expect(() =>
    authEnvironment({ ...baseline, AUTH_SOCIAL_PROVIDER: "invented" }),
  ).toThrow();
  expect(() =>
    authEnvironment({
      ...baseline,
      AUTH_SOCIAL_PROVIDER: "google",
      AUTH_GOOGLE_CLIENT_ID: "client",
    }),
  ).toThrow();
  const oidc = authEnvironment({
    ...baseline,
    AUTH_OIDC_ISSUER: "https://idp.example.test/",
    AUTH_OIDC_CLIENT_ID: "client",
    AUTH_OIDC_CLIENT_SECRET: "secret",
  });
  expect(oidc.auth.oauthProviders?.[0]).toMatchObject({
    discoveryUrl: "https://idp.example.test/.well-known/openid-configuration",
    requireIdTokenVerification: true,
    scopes: ["openid", "email", "profile"],
  });
  expect(() =>
    authEnvironment({ ...baseline, AUTH_OIDC_CLIENT_ID: "incomplete" }),
  ).toThrow();
});

it("normalizes the public origin and rejects paths, credentials and non-HTTP schemes", () => {
  expect(publicUrlSchema.parse("https://sessions.example.test/")).toBe(
    "https://sessions.example.test",
  );
  for (const value of [
    "file:///tmp/site",
    "https://site.test/path",
    "https://user:password@site.test",
    "https://site.test?query=1",
    "https://site.test#fragment",
  ])
    expect(publicUrlSchema.safeParse(value).success).toBe(false);
});
