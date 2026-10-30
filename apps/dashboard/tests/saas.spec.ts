import { selectOrganization } from "./organization-controls";
import {
  accessible,
  accountLocation,
  activate,
  openPasswordSignIn,
  cookieSchema,
  test,
  themeToggle,
} from "./browser-test";
import { expect, type Page, type APIRequestContext } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { copy } from "../src/copy";
import { paths } from "../src/lib/routes";
import {
  saasCalendarOrigin,
  saasOrigin,
  saasStatePath,
} from "../playwright.shared";
import { testAccountPassword } from "../../api/test/support";
const origin = saasOrigin;
const stateSchema = z.object({
  controlUrl: z.url(),
  controlToken: z.string(),
  ownerCookies: z.array(cookieSchema),
  memberCookies: z.array(cookieSchema),
  organizationId: z.string(),
});
async function fixture() {
  return stateSchema.parse(JSON.parse(await readFile(saasStatePath, "utf8")));
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
/** Puts the page in one theme through the visible toggle. */
async function theme(page: Page, value: "light" | "dark", isMobile: boolean) {
  if ((await page.locator("html").getAttribute("data-theme")) !== value)
    await activate(
      themeToggle(page, value === "light" ? "dark" : "light"),
      isMobile,
    );
  await expect(page.locator("html")).toHaveAttribute("data-theme", value);
}
const exact = (label: string) =>
  new RegExp(`^${label.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
/** The value under a stat label on the billing page. */
const stat = (page: Page, label: string) =>
  page
    .locator("p")
    .filter({ hasText: exact(label) })
    .locator("xpath=following-sibling::p[1]");
const progress = (page: Page) =>
  page.getByRole("progressbar", { name: copy.billing.progress, exact: true });

// @req R-SAAS-01 @req R-SAAS-02 @req R-SAAS-03 @req R-SAAS-04 @req R-SAAS-05 @req R-SAAS-06 @req R-SAAS-09 @req R-DASH-27
test("native signup, SMTP verification, name-only onboarding, quota and signed Stripe transitions work through the browser", async ({
  page,
  isMobile,
}) => {
  const email = `browser-${randomUUID()}@example.test`;
  await page.goto(paths.signup);
  await openPasswordSignIn(page, isMobile);
  await expect(page.getByTestId("auth-card")).toBeVisible();
  await page
    .getByLabel(copy.site.signup.name, { exact: true })
    .fill("Browser owner");
  await page.getByLabel(copy.auth.email, { exact: true }).fill(email);
  await page
    .getByLabel(copy.auth.password, { exact: true })
    .fill(testAccountPassword);
  await activate(page.getByTestId("signup-submit"), isMobile);
  await expect(
    page.getByRole("heading", { name: copy.site.signup.verifyTitle }),
  ).toBeVisible();
  await accessible(page);
  const verificationLink = await emailLink(
    page.request,
    email,
    "Verify your AgentCommons email",
  );
  for (const value of ["light", "dark"] as const) {
    await theme(page, value, isMobile);
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
    page.getByRole("heading", { name: copy.site.signup.onboardingTitle }),
  ).toBeVisible();
  // The organization form asks for a name only; the server derives the slug.
  await expect(
    page.getByLabel(copy.site.signup.slug, { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("textbox")).toHaveCount(1);
  for (const value of ["light", "dark"] as const) {
    await theme(page, value, isMobile);
    await accessible(page);
    // The signed-in address is generated per run.
    await expect(page).toHaveScreenshot(`saas-onboarding-${value}.png`, {
      mask: [page.getByText(email, { exact: true })],
    });
  }
  await page
    .getByTestId("onboarding-organization-name")
    .fill("Browser organization");
  const onboarded = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/v1/onboarding" &&
      response.request().method() === "POST",
  );
  await activate(page.getByTestId("onboarding-submit"), isMobile);
  expect((await onboarded).status()).toBe(200);
  await expect(page).toHaveURL(new RegExp(`${paths.install}$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    copy.install.title,
  );
  await expect(page.getByTestId("install-command")).toBeVisible();
  const identity = z
    .object({
      caller: z.object({ organizationId: z.string() }),
      organization: z.object({ slug: z.string(), name: z.string() }),
    })
    .parse(await (await page.request.get("/api/v1/me")).json());
  expect(identity.organization.name).toBe("Browser organization");
  expect(identity.organization.slug).toMatch(/^browser-organization(?:-\d+)?$/);
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
  await page.goto(paths.billing);
  await expect(progress(page)).toHaveAttribute("aria-valuemax", "2");
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
    hook: { sha256: "a".repeat(64), extensionSha256: null },
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
  const refresh = page.getByRole("button", {
    name: copy.app.common.refresh,
    exact: true,
  });
  await activate(refresh, isMobile);
  await expect(progress(page)).toHaveAttribute("aria-valuenow", "2");
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
  await page.goto(paths.billing);
  await expect(progress(page)).toHaveAttribute("aria-valuemax", "4");
  // Native Stripe starts a new paid billing period; earlier free usage stays in its UTC month.
  await expect(progress(page)).toHaveAttribute("aria-valuenow", "0");
  expect((await ingest(pending)).status()).toBe(202);
  for (let index = 0; index < 4; index++)
    expect((await ingest(envelope())).status()).toBe(202);
  await activate(refresh, isMobile);
  await expect(progress(page)).toHaveAttribute("aria-valuenow", "4");
  await expect(stat(page, copy.billing.used)).toHaveText("5");
  await expect(stat(page, copy.billing.overage)).toHaveText("1");
  await expect(page.getByText(copy.billing.cap, { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("link", { name: copy.site.saas.demo }),
  ).toHaveCount(0);
  for (const value of ["light", "dark"] as const) {
    await theme(page, value, isMobile);
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
  await expect(page.getByTestId("billing-plan")).toContainText(
    copy.site.saas.pro_embeddings,
  );
  await expect(page).toHaveURL(new RegExp(`${paths.billing}$`));
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
  await page.goto(paths.forgotPassword);
  await page.getByLabel(copy.auth.email, { exact: true }).fill(email);
  await activate(
    page.getByRole("button", { name: copy.site.signup.resetSubmit }),
    isMobile,
  );
  await expect(
    page.getByRole("status").filter({ hasText: copy.site.signup.resetSent }),
  ).toBeVisible();
  await page.goto(
    await emailLink(page.request, email, "Reset your AgentCommons password"),
  );
  for (const value of ["light", "dark"] as const) {
    await theme(page, value, isMobile);
    await accessible(page);
    await expect(page).toHaveScreenshot(`saas-setup-password-${value}.png`);
  }
  await page
    .getByLabel(copy.auth.newPassword, { exact: true })
    .fill(`${testAccountPassword}-reset`);
  await page
    .getByLabel(copy.auth.confirmPassword, { exact: true })
    .fill(`${testAccountPassword}-reset`);
  await activate(
    page.getByRole("button", { name: copy.auth.setupSubmit }),
    isMobile,
  );
  await expect(
    page.getByRole("status").filter({ hasText: copy.auth.setupDone }),
  ).toBeVisible();
  await page.goto(paths.login);
  await openPasswordSignIn(page, isMobile);
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(`${testAccountPassword}-reset`);
  await activate(page.getByTestId("login-submit"), isMobile);
  await expect(page).toHaveURL(new RegExp(`${paths.home}$`));
  await expect(page.getByTestId("dashboard-picker")).toBeVisible();
});

// @req R-DASH-34 @req R-SAAS-01 @req R-SAAS-09
test("a signed-out deep link survives signup, verification and onboarding, and a later sign-in returns to it", async ({
  page,
  context,
  isMobile,
}) => {
  const email = `browser-${randomUUID()}@example.test`;
  const target = `${paths.keys}#return`;
  await page.goto(target);
  await expect
    .poll(() => accountLocation(page))
    .toEqual({ path: paths.login, next: target });
  await activate(
    page.getByRole("link", { name: copy.auth.signupLink, exact: true }),
    isMobile,
  );
  await expect
    .poll(() => accountLocation(page))
    .toEqual({ path: paths.signup, next: target });
  await openPasswordSignIn(page, isMobile);
  await page
    .getByLabel(copy.site.signup.name, { exact: true })
    .fill("Browser returning owner");
  await page.getByLabel(copy.auth.email, { exact: true }).fill(email);
  await page
    .getByLabel(copy.auth.password, { exact: true })
    .fill(testAccountPassword);
  await activate(page.getByTestId("signup-submit"), isMobile);
  await expect(
    page.getByRole("heading", { name: copy.site.signup.verifyTitle }),
  ).toBeVisible();
  // The verification link carries the return address into onboarding.
  await page.goto(
    await emailLink(page.request, email, "Verify your AgentCommons email"),
  );
  await expect
    .poll(() => accountLocation(page))
    .toEqual({ path: paths.onboarding, next: target });
  await expect(
    page.getByRole("heading", { name: copy.site.signup.onboardingTitle }),
  ).toBeVisible();
  await page
    .getByTestId("onboarding-organization-name")
    .fill("Browser return organization");
  await activate(page.getByTestId("onboarding-submit"), isMobile);
  await expect(page).toHaveURL(`${origin}${target}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    copy.keys.title,
  );
  // The session is gone while the page is open: a reload asks for sign-in with the same
  // return address, and a ready account comes back through onboarding.
  await context.clearCookies();
  await page.reload();
  await expect
    .poll(() => accountLocation(page))
    .toEqual({ path: paths.login, next: target });
  await openPasswordSignIn(page, isMobile);
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(testAccountPassword);
  await activate(page.getByTestId("login-submit"), isMobile);
  await expect(page).toHaveURL(`${origin}${target}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    copy.keys.title,
  );
});

// @req R-SAAS-01 @req R-SAAS-04 @req R-SAAS-07 @req R-DASH-27 @req R-WEB-02
test("SaaS public, account and billing screens preserve mobile access, ownership and both themes", async ({
  page,
  context,
  browser,
  isMobile,
}, info) => {
  const state = await fixture();
  for (const path of [
    paths.site,
    "/docs",
    paths.signup,
    paths.login,
    paths.verifyEmail,
    paths.forgotPassword,
  ]) {
    await page.goto(path);
    await expect(page.locator("h1")).toBeVisible();
    for (const value of ["light", "dark"] as const) {
      await theme(page, value, isMobile);
      await accessible(page);
      // Soft, as in visual.spec.ts: one mismatch must not hide the screens after it.
      await expect
        .soft(page)
        .toHaveScreenshot(`saas-${path.slice(1) || "landing"}-${value}.png`, {
          fullPage: true,
        });
    }
  }
  await page.goto(paths.login);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    copy.auth.welcomeBack,
  );
  await expect(
    page.getByRole("link", { name: copy.auth.signupLink, exact: true }),
  ).toHaveAttribute("href", paths.signup);
  await expect(
    page.getByRole("link", { name: copy.site.signup.forgot, exact: true }),
  ).toHaveAttribute("href", paths.forgotPassword);
  await expect(
    page.getByRole("link", { name: copy.site.signup.verifyEmail, exact: true }),
  ).toHaveAttribute("href", paths.verifyEmail);
  const noJs = await browser.newContext({
    javaScriptEnabled: false,
    viewport: info.project.use.viewport ?? { width: 390, height: 844 },
  });
  try {
    const document = await noJs.newPage();
    await document.goto(origin);
    await expect(
      document.getByRole("heading", { name: copy.site.saas.pricingTitle }),
    ).toBeVisible();
    await expect(
      document.locator(".pricing-free .plan-allowance"),
    ).toContainText("2");
    await expect(
      document.locator(".pricing-pro .plan-allowance"),
    ).toContainText("4");
    await expect(
      document.getByText(copy.site.saas.madeIn, { exact: false }),
    ).toBeVisible();
  } finally {
    await noJs.close();
  }
  await context.addCookies(state.memberCookies);
  await page.goto(paths.billing);
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
  await page.goto(paths.billing);
  await selectOrganization(page, state.organizationId, isMobile);
  await expect(progress(page)).toHaveAttribute("aria-valuenow", "0");
  await expect(page.getByTestId("billing-plan")).toContainText(
    copy.site.saas.free,
  );
  for (const value of ["light", "dark"] as const) {
    await theme(page, value, isMobile);
    await accessible(page);
    await expect.soft(page).toHaveScreenshot(`saas-billing-${value}.png`, {
      fullPage: true,
      mask: [page.getByTestId("billing-plan").locator("dd")],
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
  await page.goto(`${saasCalendarOrigin}/#demo`);
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
  for (const value of ["light", "dark"] as const) {
    await theme(page, value, isMobile);
    await accessible(page);
  }
  const state = await fixture();
  await context.addCookies(state.ownerCookies);
  await page.goto(`${saasCalendarOrigin}${paths.billing}`);
  await selectOrganization(page, state.organizationId, isMobile);
  await expect(
    page.getByRole("button", { name: copy.billing.upgrade }),
  ).toBeDisabled();
  await expect(
    page.getByText(copy.site.saas.checkoutUnavailable, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: copy.site.saas.demo }),
  ).toHaveAttribute(
    "href",
    "https://cal.com/agentcommons-provider-fixture/demo",
  );
  const response = await page.request.post(
    `${saasCalendarOrigin}/api/v1/billing/checkout`,
    { headers: { origin: saasCalendarOrigin }, data: { plan: "pro" } },
  );
  expect(response.status()).toBe(503);
});
