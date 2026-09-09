import { startTraceDatabase } from "../../../packages/traces/test/support.js";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { startApp, type StartedApp } from "./app.js";
import {
  testAuthConfiguration,
  testAccountPassword,
  provisionOrganization,
  releaser,
  verifyEmail,
} from "./support.js";
import { startMailpit } from "./mailpit.js";

let db: Awaited<ReturnType<typeof startTraceDatabase>>;
let mail: Awaited<ReturnType<typeof startMailpit>>;
let runtime: StartedApp["runtime"];
let app: StartedApp["app"];
let logs: string[] = [];
const { defer, release } = releaser();
let clientIndex = 0;
let clientIp = "10.20.0.1";
beforeEach(() => {
  clientIp = `10.20.0.${String(++clientIndex)}`;
});
const origin = testAuthConfiguration.publicUrl;
async function post(path: string, payload: object, cookie?: string) {
  return app.inject({
    remoteAddress: clientIp,
    method: "POST",
    url: path,
    headers: { origin, ...(cookie ? { cookie } : {}) },
    payload,
  });
}
async function signup(email: string, name = "SaaS member") {
  const response = await post("/auth/sign-up/email", {
    email,
    password: testAccountPassword,
    name,
    callbackURL: `${origin}/onboarding`,
  });
  expect(response.statusCode, response.body).toBe(200);
  return response;
}
async function verify(email: string) {
  const messages = await mail.messages(email);
  const message = z
    .object({ Text: z.string() })
    .parse(
      messages.find(
        (item) => item.Subject === "Verify your AgentCommons email",
      ),
    );
  const url = z.url().parse(message.Text.match(/https?:\/\/\S+/)?.[0]);
  const response = await app.inject({
    remoteAddress: clientIp,
    method: "GET",
    url: new URL(url).pathname + new URL(url).search,
  });
  expect(response.statusCode, response.body).toBe(302);
  return response.cookies
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}
beforeAll(async () => {
  db = await startTraceDatabase();
  defer(() => db.close());
  mail = await startMailpit();
  defer(() => mail.close());
  // This file keeps the default log level so the request logs it asserts on exist.
  const started = await startApp(
    db,
    {
      INSTANCE_MODE: "saas",
      EMAIL_TRANSPORT: "smtp",
      EMAIL_FROM: "no-reply@example.test",
      SMTP_URL: mail.smtpUrl,
      LOG_LEVEL: "info",
    },
    { jobs: true, captureLogs: true },
  );
  defer(() => started.close());
  ({ runtime, app, logs } = started);
});
afterAll(release);

// @req R-SAAS-01 @req R-SAAS-02
it("uses native verification, creates one organization across concurrent retries, and delivers one durable welcome", async () => {
  const email = `${randomUUID()}@example.test`;
  const displaySecret = "sk-proj-" + "b".repeat(32);
  await signup(email, `SaaS member ${displaySecret}`);
  const user = await db.prisma.user.findUniqueOrThrow({ where: { email } });
  expect(user.emailVerified).toBe(false);
  expect(user.name).not.toContain(displaySecret);
  expect(user.name).toContain("REDACTED");
  expect(await db.prisma.member.count({ where: { userId: user.id } })).toBe(0);
  const denied = await post("/auth/sign-in/email", {
    email,
    password: testAccountPassword,
  });
  expect(denied.statusCode).toBe(403);
  expect(
    (
      await post("/api/v1/onboarding", {
        name: "Unauthorized",
        slug: "unauthorized",
      })
    ).statusCode,
  ).toBe(401);
  const cookie = await verify(email);
  const me = await app.inject({
    remoteAddress: clientIp,
    url: "/api/v1/me",
    headers: { cookie },
  });
  expect(me.statusCode, me.body).toBe(200);
  expect(me.json()).toMatchObject({
    user: { email_verified: true },
    onboarding: "create_organization",
    caller: null,
  });
  const secret = "ghp_" + "a".repeat(36);
  const input = {
    name: `New organization ${secret}`,
    slug: `saas-${randomUUID()}`,
  };
  const responses = await Promise.all([
    post("/api/v1/onboarding", input, cookie),
    post("/api/v1/onboarding", input, cookie),
  ]);
  for (const response of responses)
    expect(response.statusCode, response.body).toBe(200);
  const results = responses.map((response) =>
    z
      .object({ organization_id: z.string(), created: z.boolean() })
      .parse(response.json()),
  );
  expect(new Set(results.map((result) => result.organization_id)).size).toBe(1);
  const organization = await db.prisma.organization.findUniqueOrThrow({
    where: { id: z.string().parse(results[0]?.organization_id) },
  });
  expect(organization.name).not.toContain(secret);
  expect(organization.name).toContain("REDACTED");
  expect(logs.join("")).not.toContain(secret);
  expect(results.filter((result) => result.created)).toHaveLength(1);
  expect(
    await db.prisma.member.findMany({ where: { userId: user.id } }),
  ).toEqual([
    expect.objectContaining({
      role: "owner",
      suspended: false,
      removedAt: null,
    }),
  ]);
  expect(
    await db.prisma.redactionPolicy.count({
      where: { organizationId: z.string().parse(results[0]?.organization_id) },
    }),
  ).toBeGreaterThan(0);
  await vi.waitFor(
    async () => {
      expect(
        (await mail.messages(email)).filter(
          (message) =>
            message.Subject === "Your AgentCommons organization is ready",
        ),
      ).toHaveLength(1);
    },
    { timeout: 15_000 },
  );
  const retry = await post(
    "/api/v1/onboarding",
    { name: "Ignored retry", slug: `retry-${randomUUID()}` },
    cookie,
  );
  expect(retry.statusCode, retry.body).toBe(200);
  expect(retry.json()).toMatchObject({
    created: false,
    organization_id: results[0]?.organization_id,
  });
  expect(
    await db.prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
  ).toMatchObject({
    onboardingOrganizationId: results[0]?.organization_id,
  });
  expect(
    (await db.prisma.user.findUniqueOrThrow({ where: { id: user.id } }))
      .welcomeQueuedAt,
  ).toBeInstanceOf(Date);
});

// @req R-SAAS-01 @req R-SAAS-02
it("does not overwrite provisioned identities and keeps customer public signup and email recovery disabled", async () => {
  const existing = await provisionOrganization(db, `existing-${randomUUID()}`);
  const user = await db.prisma.user.findUniqueOrThrow({
    where: { email: existing.email },
  });
  const before = await db.prisma.account.findMany({
    where: { userId: user.id },
  });
  await post("/auth/sign-up/email", {
    email: existing.email,
    password: "An attacker supplied password 123!",
    name: "overwrite",
    callbackURL: `${origin}/onboarding`,
  });
  expect(
    await db.prisma.account.findMany({ where: { userId: user.id } }),
  ).toEqual(before);
  expect(
    (await db.prisma.user.findUniqueOrThrow({ where: { id: user.id } })).name,
  ).toBe(user.name);
  const request = new Request(`${origin}/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({
      email: `${randomUUID()}@example.test`,
      password: testAccountPassword,
      name: "Not public",
    }),
  });
  await expect(db.auth.handle(request, existing.owner)).rejects.toMatchObject({
    statusCode: 404,
  });
  await expect(
    db.auth.handle(
      new Request(`${origin}/auth/request-password-reset`, {
        method: "POST",
        headers: { "content-type": "application/json", origin },
        body: JSON.stringify({ email: existing.email }),
      }),
      existing.owner,
    ),
  ).rejects.toMatchObject({ statusCode: 404 });
});

// @req R-SAAS-01 @req R-SAAS-02 @req R-AUD-01
it("rolls back onboarding and welcome enqueue when its audit fails, then retries successfully", async () => {
  const email = `${randomUUID()}@example.test`;
  await signup(email);
  const cookie = await verify(email);
  const user = await db.prisma.user.findUniqueOrThrow({ where: { email } });
  const original = runtime.services.audit.write.bind(runtime.services.audit);
  const spy = vi
    .spyOn(runtime.services.audit, "write")
    .mockImplementation(async (context, description, tx) => {
      if (
        description.action === "auth.onboard" &&
        (description.statusCode ?? 200) === 200
      )
        throw new Error("Injected onboarding audit failure");
      return original(context, description, tx);
    });
  const input = { name: "Audit rollback", slug: `rollback-${randomUUID()}` };
  expect((await post("/api/v1/onboarding", input, cookie)).statusCode).toBe(
    500,
  );
  spy.mockRestore();
  expect(await db.prisma.member.count({ where: { userId: user.id } })).toBe(0);
  expect(
    await db.prisma.organization.count({ where: { slug: input.slug } }),
  ).toBe(0);
  expect(
    await db.prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
  ).toMatchObject({ onboardingOrganizationId: null, welcomeQueuedAt: null });
  expect(
    await db.prisma.$queryRaw<
      Array<{ count: bigint }>
    >`SELECT count(*) FROM pgboss.job WHERE name='welcome-email' AND data->>'userId'=${user.id}`,
  ).toEqual([{ count: 0n }]);
  const retried = await post("/api/v1/onboarding", input, cookie);
  expect(retried.statusCode, retried.body).toBe(200);
});

// @req R-SAAS-01 @req R-SAAS-02 @req R-RED-08
it("uses emailed native reset tokens once, verifies placeholders, and never stores email links in audits", async () => {
  const email = `${randomUUID()}@example.test`;
  await signup(email);
  await verify(email);
  const request = await post("/auth/request-password-reset", {
    email,
    redirectTo: `${origin}/setup-password`,
  });
  expect(request.statusCode, request.body).toBe(200);
  const message = z
    .object({ Text: z.string() })
    .parse(
      (await mail.messages(email)).find(
        (item) => item.Subject === "Reset your AgentCommons password",
      ),
    );
  const link = z.url().parse(message.Text.match(/https?:\/\/\S+/)?.[0]);
  const forwarded = await app.inject({
    remoteAddress: clientIp,
    url: new URL(link).pathname + new URL(link).search,
  });
  expect(forwarded.statusCode).toBe(302);
  const token = z
    .string()
    .min(1)
    .parse(
      new URL(z.string().parse(forwarded.headers.location)).searchParams.get(
        "token",
      ),
    );
  const nextPassword = "A new verified password 1234!";
  expect(
    (await post("/auth/reset-password", { token, newPassword: nextPassword }))
      .statusCode,
  ).toBe(200);
  expect(
    (
      await post("/auth/reset-password", {
        token,
        newPassword: testAccountPassword,
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await post("/auth/sign-in/email", {
        email,
        password: testAccountPassword,
      })
    ).statusCode,
  ).toBe(401);
  expect(
    (await post("/auth/sign-in/email", { email, password: nextPassword }))
      .statusCode,
  ).toBe(200);
  expect(JSON.stringify(await db.prisma.auditEvent.findMany())).not.toContain(
    token,
  );
  expect(logs.join("")).not.toContain(token);
  expect(logs.join("")).toContain("/auth/reset-password/:token");
  const placeholderEmail = `${randomUUID()}@example.test`;
  const placeholder = await db.auth.native.api.createUser({
    body: { email: placeholderEmail, name: "Invited person" },
  });
  expect(
    (
      await post("/auth/send-verification-email", {
        email: placeholderEmail,
        callbackURL: `${origin}/onboarding`,
      })
    ).statusCode,
  ).toBe(200);
  const placeholderCookie = await verify(placeholderEmail);
  expect(
    (
      await app.inject({
        remoteAddress: clientIp,
        url: "/api/v1/me",
        headers: { cookie: placeholderCookie },
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (
      await db.prisma.user.findUniqueOrThrow({
        where: { id: placeholder.user.id },
      })
    ).emailVerified,
  ).toBe(true);
});

// @req R-SAAS-01 @req R-SAAS-02 @req R-AUD-01
it("withholds verification after audit failure, rejects expired reset tokens, and requires verified key issuers", async () => {
  const email = `${randomUUID()}@example.test`;
  await signup(email);
  const user = await db.prisma.user.findUniqueOrThrow({ where: { email } });
  const message = z
    .object({ Text: z.string() })
    .parse(
      (await mail.messages(email)).find(
        (item) => item.Subject === "Verify your AgentCommons email",
      ),
    );
  const url = new URL(z.url().parse(message.Text.match(/https?:\/\/\S+/)?.[0]));
  const bad = new URL(url);
  bad.searchParams.set(
    "token",
    `${z.string().parse(bad.searchParams.get("token"))}x`,
  );
  await app.inject({ remoteAddress: clientIp, url: bad.pathname + bad.search });
  expect(
    (await db.prisma.user.findUniqueOrThrow({ where: { id: user.id } }))
      .emailVerified,
  ).toBe(false);
  const original = runtime.services.audit.write.bind(runtime.services.audit);
  const spy = vi
    .spyOn(runtime.services.audit, "write")
    .mockImplementation(async (context, description, tx) => {
      if (
        description.action === "auth.verify-email" &&
        (description.statusCode ?? 200) < 400
      )
        throw new Error("Verification audit rollback");
      return original(context, description, tx);
    });
  const denied = await app.inject({
    remoteAddress: clientIp,
    url: url.pathname + url.search,
  });
  expect(denied.statusCode).toBe(500);
  expect(denied.cookies).toHaveLength(0);
  expect(
    (await db.prisma.user.findUniqueOrThrow({ where: { id: user.id } }))
      .emailVerified,
  ).toBe(false);
  spy.mockRestore();
  await verify(email);
  await post("/auth/request-password-reset", {
    email,
    redirectTo: `${origin}/setup-password`,
  });
  const reset = await db.prisma.verification.findFirstOrThrow({
    where: { value: user.id, identifier: { startsWith: "reset-password:" } },
  });
  await db.prisma.verification.update({
    where: { id: reset.id },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  expect(
    (
      await post("/auth/reset-password", {
        token: reset.identifier.slice("reset-password:".length),
        newPassword: "Expired reset must not work 123!",
      })
    ).statusCode,
  ).toBe(400);
  const existing = await provisionOrganization(
    db,
    `unverified-${randomUUID()}`,
  );
  expect(
    (
      await app.inject({
        remoteAddress: clientIp,
        url: "/api/v1/sessions",
        headers: { authorization: `Bearer ${existing.key}` },
      })
    ).statusCode,
  ).toBe(403);
  await verifyEmail(db, z.string().parse(existing.owner.caller?.userId));
  expect(
    (
      await app.inject({
        remoteAddress: clientIp,
        url: "/api/v1/sessions",
        headers: { authorization: `Bearer ${existing.key}` },
      })
    ).statusCode,
  ).toBe(200);
});

// @req R-SAAS-01 @req R-SAAS-02
it("retries a failed welcome independently and does not grant a second organization after removal", async () => {
  const email = `${randomUUID()}@example.test`;
  await signup(email);
  const cookie = await verify(email);
  const mailer = runtime.services.auth.config.mail;
  if (!mailer) throw new Error("SMTP fixture missing");
  const send = mailer.send.bind(mailer);
  let attempts = 0;
  const spy = vi.spyOn(mailer, "send").mockImplementation(async (input) => {
    if (input.kind === "welcome" && input.to === email && ++attempts === 1)
      throw new Error("Transient SMTP delivery failure");
    await send(input);
  });
  const created = await post(
    "/api/v1/onboarding",
    { name: "Retry welcome", slug: `welcome-${randomUUID()}` },
    cookie,
  );
  expect(created.statusCode, created.body).toBe(200);
  await vi.waitFor(
    () => {
      expect(attempts).toBe(1);
    },
    { timeout: 5000 },
  );
  expect(
    (
      await app.inject({
        remoteAddress: clientIp,
        url: "/api/v1/me",
        headers: { cookie },
      })
    ).json(),
  ).toMatchObject({ onboarding: "ready" });
  await vi.waitFor(
    async () => {
      expect(
        (await mail.messages(email)).filter(
          (message) =>
            message.Subject === "Your AgentCommons organization is ready",
        ),
      ).toHaveLength(1);
    },
    { timeout: 75_000 },
  );
  spy.mockRestore();
  expect(attempts).toBe(2);
  const user = await db.prisma.user.findUniqueOrThrow({ where: { email } });
  expect(
    await db.prisma.$queryRaw<
      Array<{ count: bigint; retries: number }>
    >`SELECT count(*)::bigint AS count, max(retry_count)::integer AS retries FROM pgboss.job WHERE name='welcome-email' AND data->>'userId'=${user.id}`,
  ).toEqual([{ count: 1n, retries: 1 }]);
  await db.prisma.member.updateMany({
    where: { userId: user.id },
    data: { removedAt: new Date(), suspended: true },
  });
  expect(
    (
      await post(
        "/api/v1/onboarding",
        { name: "Second free organization", slug: `second-${randomUUID()}` },
        cookie,
      )
    ).statusCode,
  ).toBe(409);
  expect(
    (
      await app.inject({
        remoteAddress: clientIp,
        url: "/api/v1/me",
        headers: { cookie },
      })
    ).json(),
  ).toMatchObject({ onboarding: "contact_admin" });
}, 90_000);
