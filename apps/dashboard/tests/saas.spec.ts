import { selectOrganization } from "./organization-controls";
import { test } from "./browser-test";
import {
  expect,
  type Page,
  type Locator,
  type APIRequestContext,
} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { copy } from "../src/copy";
import { testAccountPassword } from "../../api/test/support";
const origin = "http://localhost:3600";
const cookieSchema = z.object({
  name: z.string(),
  value: z.string(),
  domain: z.string(),
  path: z.string(),
  httpOnly: z.boolean(),
  secure: z.boolean(),
  sameSite: z.enum(["Lax", "Strict", "None"]),
});
const stateSchema = z.object({
  controlUrl: z.url(),
  controlToken: z.string(),
  ownerCookies: z.array(cookieSchema),
  memberCookies: z.array(cookieSchema),
  organizationId: z.string(),
});
async function fixture() {
  return stateSchema.parse(
    JSON.parse(
      await readFile("/tmp/agentcommons-saas-browser-state.json", "utf8"),
    ),
  );
}
async function control(
  request: APIRequestContext,
  path: string,
  method = "GET",
) {
  const state = await fixture();
  return request.fetch(`${state.controlUrl}${path}`, {
    method,
    headers: { authorization: `Bearer ${state.controlToken}` },
  });
}
async function emailLink(
  request: APIRequestContext,
  email: string,
  subject: string,
) {
  let link = "";
  await expect
    .poll(async () => {
      const response = await control(
        request,
        `/messages?email=${encodeURIComponent(email)}`,
      );
      const messages = z
        .array(z.object({ Subject: z.string(), Text: z.string() }))
        .parse(await response.json());
      link =
        messages
          .find((message) => message.Subject === subject)
          ?.Text.match(/https?:\/\/\S+/)?.[0] ?? "";
      return link;
    })
    .not.toBe("");
  return z.url().parse(link);
}
async function activate(locator: Locator, mobile: boolean) {
  if (mobile) await locator.tap();
  else await locator.click();
}
async function accessible(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve();
          });
        });
      }),
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
}
async function theme(page: Page, value: string) {
  const toggle = page.getByRole("button", {
    name: value === "light" ? copy.theme.light : copy.theme.dark,
    exact: true,
  });
  if ((await page.locator("html").getAttribute("data-theme")) !== value)
    await activate(
      toggle,
      await page.evaluate(() => navigator.maxTouchPoints > 0),
    );
  await expect(page.locator("html")).toHaveAttribute("data-theme", value);
}

// @req R-SAAS-01 @req R-SAAS-02 @req R-SAAS-03 @req R-SAAS-04 @req R-SAAS-05 @req R-SAAS-06 @req R-DASH-10
test("native signup, SMTP verification, onboarding, quota and signed Stripe transitions work through the browser", async ({
  page,
  isMobile,
}) => {
  const email = `browser-${randomUUID()}@example.test`;
  await page.goto("/signup");
  await page
    .getByLabel(copy.signup.name, { exact: true })
    .fill("Browser owner");
  await page.getByLabel(copy.workspace.auth.email, { exact: true }).fill(email);
  await page
    .getByLabel(copy.workspace.auth.password, { exact: true })
    .fill(testAccountPassword);
  await activate(
    page.getByRole("button", { name: copy.signup.submit, exact: true }),
    isMobile,
  );
  await expect(
    page.getByRole("heading", { name: copy.signup.verifyTitle }),
  ).toBeVisible();
  await accessible(page);
  const verificationLink = await emailLink(
    page.request,
    email,
    "Verify your AgentCommons email",
  );
  for (const value of ["light", "dark"]) {
    await theme(page, value);
    await expect(page).toHaveScreenshot(
      `saas-verification-notice-${value}.png`,
      { mask: [page.locator(".verified-email")] },
    );
  }
  const denied = await page.request.post("/auth/sign-in/email", {
    headers: { origin },
    data: { email, password: testAccountPassword },
  });
  expect(denied.status()).toBe(403);
  await page.goto(verificationLink);
  await expect(
    page.getByRole("heading", { name: copy.signup.onboardingTitle }),
  ).toBeVisible();
  for (const value of ["light", "dark"]) {
    await theme(page, value);
    await accessible(page);
    await expect(page).toHaveScreenshot(`saas-onboarding-${value}.png`);
  }
  await page
    .getByLabel(copy.signup.organizationName, { exact: true })
    .fill("Browser organization");
  await page
    .getByLabel(copy.signup.slug, { exact: true })
    .fill(`browser-${randomUUID()}`);
  await activate(
    page.getByRole("button", { name: copy.signup.organizationSubmit }),
    isMobile,
  );
  await expect(page).toHaveURL(/\/home$/);
  const identity = z
    .object({ caller: z.object({ organizationId: z.string() }) })
    .parse(await (await page.request.get("/api/v1/me")).json());
  await expect
    .poll(async () => {
      const response = await control(
        page.request,
        `/messages?email=${encodeURIComponent(email)}`,
      );
      return z
        .array(z.object({ Subject: z.string() }))
        .parse(await response.json())
        .filter(
          (message) =>
            message.Subject === "Your AgentCommons organization is ready",
        ).length;
    })
    .toBe(1);
  await page.goto("/usage");
  await expect(page.getByRole("progressbar")).toHaveAttribute("max", "2");
  const created = await page.request.post("/api/v1/me/keys", {
    headers: { origin },
    data: {
      name: "Browser quota capture",
      permissions: { sessions: ["ingest", "read"] },
    },
  });
  expect(created.status()).toBe(200);
  const { key } = z.object({ key: z.string() }).parse(await created.json());
  const installationId = randomUUID();
  const envelope = () => ({
    envelopeVersion: 2,
    harness: "CLAUDE_CODE",
    harnessSessionId: randomUUID(),
    behavior: "sync",
    nativeEvent: "Stop",
    batchId: randomUUID(),
    installationId,
    sentAt: new Date().toISOString(),
    sourcePos: 0,
    context: {
      cwd: "/browser",
      installation: {
        hostname: "saas-browser",
        osUser: "developer",
        platform: "linux",
        arch: "x64",
      },
      git: null,
      parentHint: null,
    },
    records: [
      {
        pos: 0,
        sourceVersion: 0,
        key: "browser-user",
        line: JSON.stringify({
          type: "user",
          uuid: "browser-user",
          message: {
            content: [
              {
                type: "text",
                text: "Browser quota admission is a captured session attempt.",
              },
            ],
          },
        }),
      },
    ],
    cursor: "1:0",
    end: null,
  });
  const ingest = (input: ReturnType<typeof envelope>) =>
    page.request.post("/api/v1/ingest", {
      headers: { authorization: `Bearer ${key}`, origin },
      data: input,
    });
  const first = envelope();
  expect((await ingest(first)).status()).toBe(202);
  expect((await ingest(envelope())).status()).toBe(202);
  const pending = envelope();
  expect((await ingest(pending)).status()).toBe(402);
  expect((await ingest({ ...first, batchId: randomUUID() })).status()).toBe(
    202,
  );
  await activate(
    page.getByRole("button", {
      name: copy.workspace.common.refresh,
      exact: true,
    }),
    isMobile,
  );
  await expect(page.getByRole("progressbar")).toHaveAttribute("value", "2");
  await expect(page.getByText(copy.billing.cap, { exact: true })).toBeVisible();
  await accessible(page);
  let checkout = "";
  await page.route("https://checkout.stripe.com/**", async (route) => {
    checkout = route.request().url();
    await route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Stripe handoff provider fixture</title><p>Provider handoff captured. No payment was made.</p>",
    });
  });
  await activate(
    page.getByRole("button", { name: copy.billing.upgrade }),
    isMobile,
  );
  await expect
    .poll(() => checkout)
    .toBe("https://checkout.stripe.com/c/pay/cs_test_protocol");
  await page.waitForURL("https://checkout.stripe.com/c/pay/cs_test_protocol");
  await page.waitForLoadState("load");
  const paid = await control(
    page.request,
    `/activate?organization=${encodeURIComponent(identity.caller.organizationId)}`,
    "POST",
  );
  expect(paid.status(), await paid.text()).toBe(200);
  await page.goto("/usage");
  await expect(page.getByRole("progressbar")).toHaveAttribute("max", "4");
  // Native Stripe starts a new paid billing period; earlier free usage stays in its UTC month.
  await expect(page.getByRole("progressbar")).toHaveAttribute("value", "0");
  expect((await ingest(pending)).status()).toBe(202);
  for (let index = 0; index < 4; index++)
    expect((await ingest(envelope())).status()).toBe(202);
  await activate(
    page.getByRole("button", {
      name: copy.workspace.common.refresh,
      exact: true,
    }),
    isMobile,
  );
  await expect(page.getByRole("progressbar")).toHaveAttribute("value", "4");
  await expect(
    page
      .locator("dl > div")
      .filter({ has: page.getByText(copy.billing.used, { exact: true }) })
      .locator("dd"),
  ).toHaveText("5");
  await expect(
    page
      .locator("dl > div")
      .filter({ has: page.getByText(copy.billing.overage, { exact: true }) })
      .locator("dd"),
  ).toHaveText("1");
  await expect(page.getByText(copy.billing.cap, { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByText(copy.saas.calendarUnavailable, { exact: true }),
  ).toBeVisible();
  for (const value of ["light", "dark"]) {
    await theme(page, value);
    await accessible(page);
  }
  await page
    .getByRole("combobox", { name: copy.billing.planChoice, exact: true })
    .selectOption("pro_embeddings");
  const changedPlan = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/billing/checkout") &&
      response.request().method() === "POST",
  );
  await activate(
    page.getByRole("button", { name: copy.billing.changePlan, exact: true }),
    isMobile,
  );
  const changed = await changedPlan;
  expect(changed.status(), await changed.text()).toBe(200);
  expect(await changed.json()).toEqual({ url: null });
  await expect(
    page
      .locator("dl > div")
      .filter({ has: page.getByText(copy.billing.plan, { exact: true }) })
      .locator("dd"),
  ).toHaveText(copy.saas.pro_embeddings);
  await expect(page).toHaveURL(/\/usage$/);
  let portal = "";
  await page.route("https://billing.stripe.com/**", async (route) => {
    portal = route.request().url();
    await route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Stripe handoff provider fixture</title><p>Provider handoff captured. No payment was made.</p>",
    });
  });
  await activate(
    page.getByRole("button", { name: copy.billing.portal }),
    isMobile,
  );
  await expect
    .poll(() => portal)
    .toBe("https://billing.stripe.com/p/session/test_protocol");
  await page.waitForURL("https://billing.stripe.com/p/session/test_protocol");
  await page.waitForLoadState("load");
  await page.goto("/forgot-password");
  await page.getByLabel(copy.workspace.auth.email, { exact: true }).fill(email);
  await activate(
    page.getByRole("button", { name: copy.signup.resetSubmit }),
    isMobile,
  );
  await expect(page.getByRole("status")).toHaveText(copy.signup.resetSent);
  await page.goto(
    await emailLink(page.request, email, "Reset your AgentCommons password"),
  );
  for (const value of ["light", "dark"]) {
    await theme(page, value);
    await accessible(page);
    await expect(page).toHaveScreenshot(`saas-setup-password-${value}.png`);
  }
  await page
    .getByLabel(copy.workspace.auth.newPassword, { exact: true })
    .fill(`${testAccountPassword}-reset`);
  await page
    .getByLabel(copy.workspace.auth.confirmPassword, { exact: true })
    .fill(`${testAccountPassword}-reset`);
  await activate(
    page.getByRole("button", { name: copy.workspace.auth.setupSubmit }),
    isMobile,
  );
  await expect(page.getByRole("status")).toHaveText(
    copy.workspace.auth.setupDone,
  );
  await page.goto("/login");
  await page.getByLabel(copy.workspace.auth.email, { exact: true }).fill(email);
  await page
    .getByLabel(copy.workspace.auth.password, { exact: true })
    .fill(`${testAccountPassword}-reset`);
  await activate(
    page.getByRole("button", { name: copy.workspace.auth.signIn, exact: true }),
    isMobile,
  );
  await expect(page).toHaveURL(/\/home$/);
});

// @req R-SAAS-01 @req R-SAAS-04 @req R-SAAS-07 @req R-DASH-10
test("SaaS public and billing screens preserve mobile access, ownership and both themes", async ({
  page,
  context,
  browser,
}, info) => {
  const state = await fixture();
  for (const path of [
    "/",
    "/docs",
    "/signup",
    "/login",
    "/verify-email",
    "/forgot-password",
  ]) {
    await page.goto(path);
    await expect(page.locator("h1")).toBeVisible();
    for (const value of ["light", "dark"]) {
      await theme(page, value);
      await accessible(page);
      await expect(page).toHaveScreenshot(
        `saas-${path.slice(1) || "landing"}-${value}.png`,
        { fullPage: true },
      );
    }
  }
  const noJs = await browser.newContext({
    javaScriptEnabled: false,
    viewport: info.project.use.viewport ?? { width: 390, height: 844 },
  });
  try {
    const document = await noJs.newPage();
    await document.goto(origin);
    await expect(
      document.getByRole("heading", { name: copy.saas.pricingTitle }),
    ).toBeVisible();
    await expect(
      document.locator(".pricing-free .plan-allowance"),
    ).toContainText("2");
    await expect(
      document.locator(".pricing-pro .plan-allowance"),
    ).toContainText("4");
    await expect(
      document.getByText(copy.saas.madeIn, { exact: false }),
    ).toBeVisible();
  } finally {
    await noJs.close();
  }
  await context.addCookies(state.memberCookies);
  await page.goto("/usage");
  await expect(
    page.getByText(copy.billing.ownerOnly, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: copy.billing.upgrade }),
  ).toHaveCount(0);
  expect(
    (
      await page.request.post("/api/v1/billing/checkout", {
        headers: { origin },
        data: { plan: "pro" },
      })
    ).status(),
  ).toBe(403);
  await context.addCookies(state.ownerCookies);
  await page.goto("/usage");
  await selectOrganization(page, state.organizationId);
  await expect(page.getByRole("progressbar")).toHaveAttribute("value", "0");
  for (const value of ["light", "dark"]) {
    await theme(page, value);
    await accessible(page);
    await expect(page).toHaveScreenshot(`saas-usage-${value}.png`, {
      fullPage: true,
      mask: [page.locator(".usage-period dd")],
    });
  }
});

// @req R-SAAS-01 @req R-SAAS-04 @req R-SAAS-07 @req R-DASH-10
test("official Cal embed loads a controlled provider event and missing Stripe stays unavailable", async ({
  page,
  context,
  isMobile,
}) => {
  const script = await readFile(
    new URL("./providers/cal-embed.txt", import.meta.url),
  );
  expect(createHash("sha256").update(script).digest("hex")).toBe(
    "81ad71a66da1f0aa88ce2c8d282a9e56b2b4474e8a695b87257226e51e1a4682",
  );
  const blocked: string[] = [];
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      console.error(`CSP violation: ${event.blockedURI}`);
    });
  });
  page.on("console", (message) => {
    if (message.text().startsWith("CSP violation:"))
      blocked.push(message.text());
  });
  await page.route("https://app.cal.com/embed/embed.js", async (route) => {
    await route.fulfill({
      contentType: "application/javascript",
      body: script,
    });
  });
  await page.route(
    "https://app.cal.com/agentcommons-provider-fixture/demo/embed?*",
    async (route) => {
      await route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Controlled calendar provider fixture</title><style>body{font:16px system-ui;margin:20px}button{min-height:44px;padding:12px}*{box-sizing:border-box}</style></head><body><main aria-label="Controlled demo event"><h1>Demo provider fixture</h1><p>This local event does not book a meeting.</p><button type="button" onclick="document.querySelector('[role=status]').textContent='Fixture time selected'">Select fixture time</button><p role="status"></p></main><script>for(const [type,data] of [['__iframeReady',{}],['linkReady',{}],['__dimensionChanged',{iframeHeight:340}]])parent.postMessage({fullType:'CAL:agentcommons-demo:'+type,data},'*');</script></body></html>`,
      });
    },
  );
  await page.goto("http://localhost:3601/#demo");
  const iframe = page.locator("iframe.cal-embed");
  await expect(iframe).toBeVisible();
  await expect(iframe).toHaveAttribute(
    "src",
    /agentcommons-provider-fixture\/demo\/embed/,
  );
  const provider = page.frameLocator("iframe.cal-embed");
  await activate(
    provider.getByRole("button", { name: "Select fixture time" }),
    isMobile,
  );
  await expect(provider.getByRole("status")).toHaveText(
    "Fixture time selected",
  );
  // Axe probes unsafe-eval support itself; inspect provider CSP before injecting axe.
  expect(blocked).toEqual([]);
  for (const value of ["light", "dark"]) {
    await theme(page, value);
    await accessible(page);
  }
  const state = await fixture();
  await context.addCookies(state.ownerCookies);
  await page.goto("http://localhost:3601/usage");
  await selectOrganization(page, state.organizationId);
  await expect(
    page.getByRole("button", { name: copy.billing.upgrade }),
  ).toBeDisabled();
  await expect(
    page.getByText(copy.saas.checkoutUnavailable, { exact: true }),
  ).toBeVisible();
  const response = await page.request.post(
    "http://localhost:3601/api/v1/billing/checkout",
    { headers: { origin: "http://localhost:3601" }, data: { plan: "pro" } },
  );
  expect(response.status()).toBe(503);
});
