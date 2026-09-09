import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, expect, it } from "vitest";
import { z } from "zod";
import { startTraceDatabase } from "../../../packages/traces/test/support.js";
import { startApp, type StartedApp } from "./app.js";
import {
  injectHeaders,
  provisionOrganization,
  releaser,
  testAuthConfiguration,
} from "./support.js";

let db: Awaited<ReturnType<typeof startTraceDatabase>>;
let owner: Awaited<ReturnType<typeof provisionOrganization>>;
let customer: StartedApp["app"];
let saas: StartedApp["app"];
let googleOnly: StartedApp["app"];
const { defer, release } = releaser();
const documentSchema = z.object({
  paths: z.record(z.string(), z.record(z.string(), z.unknown())),
});
/** Routes that exist only under one mode or configuration (§7.6, §9.6, §11). */
const saasOnly = [
  ["get", "/api/v1/billing"],
  ["post", "/api/v1/billing/checkout"],
  ["post", "/api/v1/billing/portal"],
  ["post", "/api/v1/onboarding"],
  ["post", "/api/v1/me/organizations"],
] as const;
const everywhere = [
  ["get", "/api/v1/me/organizations"],
  ["get", "/api/v1/admin/domains"],
  ["get", "/api/v1/billing/config"],
  ["get", "/api/v1/dashboards"],
  ["post", "/api/v1/search"],
] as const;
const removed = [
  "/api/v1/home",
  "/api/v1/home/{section}",
  "/api/v1/me/dashboards",
];

function operations(app: { swagger(): unknown }) {
  const paths = documentSchema.parse(app.swagger()).paths;
  return new Set(
    Object.entries(paths).flatMap(([path, methods]) =>
      Object.keys(methods).map((method) => `${method} ${path}`),
    ),
  );
}
async function application(overrides: Record<string, string>) {
  const started = await startApp(db, overrides);
  defer(() => started.close());
  await started.app.ready();
  return started.app;
}
const headers = () => injectHeaders(owner.owner);

beforeAll(async () => {
  db = await startTraceDatabase();
  defer(() => db.close());
  owner = await provisionOrganization(db, "instance-mode", { verified: true });
  customer = await application({});
  saas = await application({ INSTANCE_MODE: "saas" });
  googleOnly = await application({
    AUTH_EMAIL_PASSWORD_ENABLED: "false",
    AUTH_SOCIAL_PROVIDER: "google",
    AUTH_GOOGLE_CLIENT_ID: "google-test-client",
    AUTH_GOOGLE_CLIENT_SECRET: "google-test-secret",
    AUTH_SIGNUP_MODE: "invite",
  });
}, 180_000);
afterAll(release);

// @req R-ARCH-08 @req R-SAAS-01 @req R-SAAS-06 @req R-EMB-01
it("registers SaaS, domain-enrollment and similarity routes only where active and keeps the build artifact complete", async () => {
  const artifact = documentSchema.parse(
    JSON.parse(
      await readFile(new URL("../openapi.json", import.meta.url), "utf8"),
    ),
  );
  const shipped = new Set(
    Object.entries(artifact.paths).flatMap(([path, methods]) =>
      Object.keys(methods).map((method) => `${method} ${path}`),
    ),
  );
  const live = {
    customer: operations(customer),
    saas: operations(saas),
    googleOnly: operations(googleOnly),
  };
  for (const [method, path] of [...saasOnly, ...everywhere]) {
    expect(shipped.has(`${method} ${path}`), `${method} ${path}`).toBe(true);
    for (const document of Object.values(live))
      expect(document.has(`${method} ${path}`)).toBe(
        everywhere.some(([m, p]) => m === method && p === path) ||
          document === live.saas,
      );
  }
  expect(shipped.has("post /api/v1/admin/domains")).toBe(true);
  expect(live.customer.has("post /api/v1/admin/domains")).toBe(false);
  expect(live.saas.has("post /api/v1/admin/domains")).toBe(false);
  expect(live.googleOnly.has("post /api/v1/admin/domains")).toBe(true);
  expect(shipped.has("get /api/v1/sessions/{id}/similar")).toBe(true);
  for (const document of Object.values(live))
    expect(document.has("get /api/v1/sessions/{id}/similar")).toBe(false);
  for (const path of removed) {
    expect(Object.keys(artifact.paths)).not.toContain(path);
    for (const document of Object.values(live))
      expect([...document].some((entry) => entry.endsWith(` ${path}`))).toBe(
        false,
      );
  }
  // The customer instance refuses the inactive routes for an authenticated owner.
  for (const [method, path] of saasOnly) {
    const response = await customer.inject({
      method: method.toUpperCase() as "GET" | "POST",
      url: path,
      headers: headers(),
      ...(method === "post" ? { payload: {} } : {}),
    });
    expect(response.statusCode, `${method} ${path}`).toBe(404);
  }
  expect(
    (
      await customer.inject({
        method: "POST",
        url: "/api/v1/admin/domains",
        headers: headers(),
        payload: { domain: "example.org" },
      })
    ).statusCode,
  ).toBe(404);
  const domains = await customer.inject({
    method: "GET",
    url: "/api/v1/admin/domains",
    headers: headers(),
  });
  expect(domains.statusCode, domains.body).toBe(200);
  expect(domains.json()).toMatchObject({ enabled: false, items: [] });
  expect(
    (
      await customer.inject({
        method: "GET",
        url: "/api/v1/home",
        headers: headers(),
      })
    ).statusCode,
  ).toBe(404);
  const config = await customer.inject({
    method: "GET",
    url: "/api/v1/billing/config",
  });
  expect(config.statusCode).toBe(200);
  expect(config.json()).toMatchObject({
    mode: "customer",
    enabled: false,
    checkout_enabled: false,
  });
  // The SaaS instance serves the same routes to the same owner.
  const usage = await saas.inject({
    method: "GET",
    url: "/api/v1/billing",
    headers: headers(),
  });
  expect(usage.statusCode, usage.body).toBe(200);
  expect(usage.json()).toMatchObject({ plan: "free", checkout_enabled: false });
  const onboarding = await saas.inject({
    method: "POST",
    url: "/api/v1/onboarding",
    headers: headers(),
    payload: { name: "Instance mode" },
  });
  // An owner with an eligible membership is sent to the picker, not to a 404.
  expect(onboarding.statusCode, onboarding.body).toBe(409);
  expect(
    (
      await saas.inject({ method: "GET", url: "/api/v1/billing/config" })
    ).json(),
  ).toMatchObject({ mode: "saas", enabled: true });
});

// @req R-DASH-27 @req R-SAAS-06
it("returns from Stripe to the application billing page under /app and serves no legacy page paths", async () => {
  const returned = await saas.inject({
    method: "GET",
    url: "/auth/subscription/success?checkoutSessionId=forged",
  });
  expect(returned.statusCode).toBe(303);
  expect(returned.headers.location).toBe(
    `${testAuthConfiguration.publicUrl}/app/billing`,
  );
  expect(
    (
      await customer.inject({
        method: "GET",
        url: "/auth/subscription/success?checkoutSessionId=forged",
      })
    ).statusCode,
  ).toBe(404);
  const sources = await Promise.all(
    [
      "../src/auth/billing.ts",
      "../src/services/auth.ts",
      "../src/auth/mail.ts",
    ].map((file) => readFile(new URL(file, import.meta.url), "utf8")),
  );
  for (const source of sources)
    expect(source).not.toMatch(/publicUrl}\/(usage|home|installation|keys)\b/);
});
