import { waitForSession } from "./trace-controls";
import { test } from "./browser-test";
import { selectOrganization } from "./organization-controls";
import { expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { copy } from "../src/copy";
import { installVisualTime } from "./visual-time";
import {
  ingestEnvelopeSchema,
  getOutputSchema,
  rawOutputSchema,
  similarOutputSchema,
} from "@agentcommons/core/schemas";
import { randomUUID } from "node:crypto";
import Papa from "papaparse";
import { testAccountPassword } from "../../api/test/support";

const baseFixtureSchema = z.object({
  storageState: z.object({
    cookies: z.array(
      z.object({
        name: z.string(),
        value: z.string(),
        domain: z.string(),
        path: z.string(),
        httpOnly: z.boolean(),
        secure: z.boolean(),
        sameSite: z.enum(["Lax", "Strict", "None"]),
      }),
    ),
    origins: z.array(
      z.object({
        origin: z.string(),
        localStorage: z.array(
          z.object({ name: z.string(), value: z.string() }),
        ),
      }),
    ),
  }),
  ingestKey: z.string(),
  liveEnvelope: ingestEnvelopeSchema,
  sessionId: z.uuid(),
  foreignSessionId: z.uuid(),
  organizationId: z.string(),
  secondaryOrganizationId: z.string(),
  ownerEmail: z.email(),
  setupUrl: z.url(),
});
const fixtureSchema = baseFixtureSchema.extend({
  adoption: z.object({
    organizationId: z.string(),
    emptyOrganizationId: z.string(),
    ownerStorageState: baseFixtureSchema.shape.storageState,
    memberStorageState: baseFixtureSchema.shape.storageState,
  }),
  reuse: z.object({
    sourceSessionId: z.uuid(),
    targetSessionId: z.uuid(),
    installationId: z.uuid(),
    userEmail: z.email(),
    readerUserId: z.string().min(1),
    storageState: baseFixtureSchema.shape.storageState,
  }),
  visual: z.object({
    timeShiftMs: z.number().int(),
    storageState: baseFixtureSchema.shape.storageState,
    sessionId: z.uuid(),
    setupUrl: z.url(),
  }),
});
async function fixture() {
  return fixtureSchema.parse(
    JSON.parse(
      await readFile(
        process.env.DASHBOARD_BROWSER_STATE ??
          "/tmp/agentcommons-dashboard-browser-state.json",
        "utf8",
      ),
    ),
  );
}
async function accessible(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  // Theme changes and font metrics must reach a painted frame before axe caches
  // foreground/background styles for its asynchronous contrast analysis.
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
  // Reduced motion still creates finite native theme transitions. Wait for
  // their real completion so axe does not cache colors from different frames.
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document
            .getAnimations()
            .filter(
              (animation) =>
                animation instanceof CSSTransition &&
                animation.playState === "running" &&
                Number.isFinite(animation.effect?.getComputedTiming().endTime),
            ).length,
      ),
    )
    .toBe(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(
    (await new AxeBuilder({ page }).analyze()).violations.filter((entry) =>
      ["critical", "serious"].includes(entry.impact ?? ""),
    ),
  ).toEqual([]);
}
test.beforeEach(async ({ context }) => {
  const data = await fixture();
  await context.addCookies(data.storageState.cookies);
  const result = await context.request.post("/api/v1/me/organization", {
    headers: { origin: "http://localhost:3000" },
    data: { organization_id: data.organizationId },
  });
  expect(result.ok()).toBe(true);
});

// @req R-DASH-01 @req R-DASH-07 @req R-WEB-02 @req R-ORG-10
for (const theme of ["dark", "light"] as const)
  test(`every authenticated screen is accessible in ${theme}`, async ({
    page,
  }, info) => {
    const data = await fixture();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("requestfailed", (request) => {
      if (request.failure()?.errorText !== "net::ERR_ABORTED")
        errors.push(request.url());
    });
    page.on("response", (response) => {
      if (response.status() >= 400)
        errors.push(
          `${String(response.status())} ${new URL(response.url()).pathname}`,
        );
    });
    await page.addInitScript((value) => {
      localStorage.setItem("agentcommons-theme", value);
    }, theme);
    for (const path of [
      "/home",
      "/sessions",
      `/s/${data.sessionId}`,
      "/sql",
      "/keys",
      "/admin/users",
      "/admin/keys",
      "/admin/audit",
      "/admin/moderation",
      "/admin/redaction",
      "/admin/status",
    ]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.locator(".loading-state")).toHaveCount(0);
      await expect(page.getByRole("alert")).toHaveCount(0);
      await expect(
        page.getByLabel(copy.workspace.navigation.organization),
      ).toHaveAttribute("data-organization-id", data.organizationId);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await accessible(page);
      await page.screenshot({
        path: info.outputPath(`${path.replaceAll("/", "_")}-${theme}.png`),
        fullPage: true,
      });
    }
    expect(errors).toEqual([]);
  });

// @req R-DASH-11 @req R-DASH-05
test("sessions paginate, sort, choose columns and export all filtered rows", async ({
  page,
}) => {
  await page.goto("/sessions");
  await expect(page.getByRole("table")).toBeVisible();
  const next = page.getByRole("button", {
    name: copy.workspace.common.next,
    exact: true,
  });
  await expect(next).toBeEnabled();
  await next.click();
  await expect(
    page.getByRole("button", {
      name: copy.workspace.common.previous,
      exact: true,
    }),
  ).toBeEnabled();
  await expect(next).toBeDisabled();
  await page
    .getByRole("button", { name: copy.workspace.common.previous, exact: true })
    .click();
  await page
    .getByRole("combobox", { name: copy.workspace.common.sortBy, exact: true })
    .selectOption("started_at");
  await page
    .getByRole("button", {
      name: copy.workspace.common.sortDescending,
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", {
      name: copy.workspace.common.sortAscending,
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: copy.workspace.common.columns, exact: true })
    .click();
  const chooser = page.getByRole("dialog");
  await chooser
    .getByRole("checkbox", { name: copy.workspace.fields.harness, exact: true })
    .uncheck();
  await chooser
    .getByRole("button", { name: copy.workspace.common.close, exact: true })
    .click();
  await expect(
    page.getByRole("columnheader", {
      name: copy.workspace.fields.harness,
      exact: true,
    }),
  ).toHaveCount(0);
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: copy.workspace.common.export, exact: true })
    .click();
  const download = await downloadPromise;
  const path = await download.path();
  const csv = await readFile(path, "utf8");
  const expected = await page.request.get("/api/v1/sessions?limit=100");
  const rows = z
    .object({
      items: z.array(z.object({ session_id: z.uuid() })),
      cursor: z.null(),
    })
    .parse(await expected.json());
  expect(Papa.parse(csv, { header: true }).data).toHaveLength(
    rows.items.length,
  );
  expect(csv).not.toContain("browser-secondary");
});

// @req R-DASH-03 @req R-DASH-10 @req R-DASH-02
test("session deep links, transcript controls, raw payload and tree work with keyboard", async ({
  page,
}) => {
  const data = await fixture();
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(`/s/${data.sessionId}#1`);
  await expect(page.locator(".transcript-message.selected")).toHaveAttribute(
    "id",
    "1",
  );
  const output = getOutputSchema.parse(
    await (await page.request.get(`/api/v1/sessions/${data.sessionId}`)).json(),
  );
  const details = page.locator(".session-details");
  await details.locator("summary").click();
  await expect(details.locator("dt")).toHaveText(
    Object.keys(output.header)
      .filter((key) => key !== "parent" && key !== "children")
      .map(
        (key) => (copy.workspace.fields as Record<string, string>)[key] ?? key,
      ),
  );
  const identity = details.locator("dl > div").filter({
    has: page.getByText(copy.workspace.fields.session_id, { exact: true }),
  });
  await identity.getByRole("button").click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    data.sessionId,
  );
  await details.locator("summary").click();
  const source = page.locator(
    ".transcript-message.selected .transcript-message-footer summary",
  );
  await expect(source).toHaveAttribute(
    "title",
    new RegExp(copy.workspace.fields.raw_record_id),
  );
  await source.click();
  await expect(
    page.locator(".transcript-message.selected .transcript-message-footer"),
  ).toContainText(copy.workspace.fields.ingest_batch_id);
  await page
    .getByLabel(copy.workspace.detail.thinking, { exact: true })
    .uncheck();
  await expect(page.locator(".transcript-message.selected")).toHaveCount(0);
  await page
    .getByLabel(copy.workspace.detail.thinking, { exact: true })
    .check();
  await page
    .getByRole("tab", { name: copy.workspace.detail.transcript, exact: true })
    .focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: copy.workspace.detail.raw, exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.locator(".raw-record summary").first().click();
  await expect(page.locator(".raw-record pre").first()).toContainText(
    "Dashboard verification",
  );
  await page
    .getByRole("tab", { name: copy.workspace.detail.raw, exact: true })
    .focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: copy.workspace.detail.tree, exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".session-tree .current")).toBeVisible();
  await accessible(page);
});

// @req R-ORG-10 @req R-ORG-08
test("organization switch clears previous data and closes its stream", async ({
  page,
}) => {
  const data = await fixture();
  let streamClosed = false;
  const closed = (url: string) => {
    if (url.endsWith(`/sessions/${data.sessionId}/events`)) streamClosed = true;
  };
  page.on("requestfinished", (request) => {
    closed(request.url());
  });
  page.on("requestfailed", (request) => {
    closed(request.url());
  });
  await page.goto(`/s/${data.sessionId}`);
  await expect(
    page.getByText(copy.workspace.detail.live, { exact: true }),
  ).toBeVisible();
  await selectOrganization(page, data.secondaryOrganizationId);
  await expect(
    page.getByLabel(copy.workspace.navigation.organization),
  ).toHaveAttribute("data-organization-id", data.secondaryOrganizationId);
  await expect(page.locator(".transcript")).toHaveCount(0);
  await expect.poll(() => streamClosed).toBe(true);
  await page.goto("/sessions");
  await expect(page.getByRole("table")).toContainText(
    "Browser pagination session 52",
  );
  await expect(page.getByRole("table")).not.toContainText(
    "Dashboard verification",
  );
  await selectOrganization(page, data.organizationId);
  await expect(
    page.getByLabel(copy.workspace.navigation.organization),
  ).toHaveAttribute("data-organization-id", data.organizationId);
  await expect(page.getByRole("table")).not.toContainText(
    "Browser pagination session 52",
  );
});

async function formThemes(page: Page) {
  await accessible(page);
  await page
    .getByRole("button", { name: copy.theme.light, exact: true })
    .click();
  await accessible(page);
  await page
    .getByRole("button", { name: copy.theme.dark, exact: true })
    .click();
}

// @req R-DASH-01 @req R-DASH-05 @req R-ORG-04
test("key creation shows its secret once and revocation requires an audited reason", async ({
  page,
}, info) => {
  const name = `Browser key ${info.project.name} ${String(Date.now())}`;
  await page.goto("/keys");
  await page
    .getByRole("button", { name: copy.workspace.keys.create, exact: true })
    .click();
  await page.getByLabel(copy.workspace.keys.name, { exact: true }).fill(name);
  await formThemes(page);
  await page
    .locator("form")
    .getByRole("button", { name: copy.workspace.keys.create, exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: copy.workspace.keys.secretTitle }),
  ).toBeVisible();
  const secret = await page.locator(".secret-value code").first().innerText();
  expect(secret.length).toBeGreaterThan(20);
  await expect(page.locator(".secret-value code").nth(1)).toContainText(secret);
  await page.getByRole("button", { name: copy.workspace.keys.dismiss }).click();
  await expect(page.locator(".secret-panel")).toHaveCount(0);
  const row = page.getByRole("row").filter({ hasText: name });
  await row
    .getByRole("button", { name: copy.workspace.keys.revoke, exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("button", {
      name: copy.workspace.keys.revoke,
      exact: true,
    }),
  ).toBeDisabled();
  await dialog
    .getByLabel(copy.workspace.common.reason, { exact: true })
    .fill("Browser verification key retired");
  await accessible(page);
  await dialog
    .getByRole("button", { name: copy.workspace.keys.revoke, exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await page.reload();
  await expect(page.locator("body")).not.toContainText(secret);
  await page.goto("/admin/audit");
  await expect(page.getByRole("table")).toContainText("keys.revoke");
});

// @req R-ORG-02 @req R-ORG-03 @req R-DASH-01 @req R-WEB-02
test("an admin adds an email and its owner completes native password setup and sign-in", async ({
  page,
  browser,
  context,
}, info) => {
  const email = `browser-${info.project.name}-${String(Date.now())}@example.com`;
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/admin/users");
  await page
    .getByRole("button", { name: copy.workspace.users.add, exact: true })
    .click();
  await page.getByLabel(copy.workspace.users.emails).fill(email);
  await formThemes(page);
  await page
    .getByRole("button", { name: copy.workspace.users.addSubmit })
    .click();
  await expect(page.locator(".access-results")).toContainText(email);
  await page
    .getByRole("button", { name: copy.workspace.auth.setupLink, exact: true })
    .click();
  const setupUrl = await page.evaluate(() => navigator.clipboard.readText());
  expect(new URL(setupUrl).origin).toBe("http://localhost:3000");
  const owner = await browser.newContext({
    viewport: info.project.use.viewport ?? { width: 1440, height: 1000 },
  });
  const setup = await owner.newPage();
  await setup.goto(setupUrl);
  const username = setup.getByLabel(copy.workspace.auth.passwordManagerEmail, {
    exact: true,
  });
  await expect(username).toHaveAttribute("autocomplete", "username");
  await username.fill(email);
  await expect(
    setup.getByLabel(copy.workspace.auth.newPassword, { exact: true }),
  ).toBeVisible();
  await formThemes(setup);
  const password = "Browser fixture native password 2345!";
  await setup
    .getByLabel(copy.workspace.auth.newPassword, { exact: true })
    .fill(password);
  await setup
    .getByLabel(copy.workspace.auth.confirmPassword, { exact: true })
    .fill(password);
  const resetRequest = setup.waitForRequest(
    (request) =>
      new URL(request.url()).pathname === "/auth/reset-password" &&
      request.method() === "POST",
  );
  await setup
    .getByRole("button", { name: copy.workspace.auth.setupSubmit })
    .click();
  expect(
    z
      .strictObject({ token: z.string(), newPassword: z.string() })
      .parse((await resetRequest).postDataJSON()),
  ).toMatchObject({ newPassword: password });
  await expect(setup.getByRole("status")).toContainText(
    copy.workspace.auth.setupDone,
  );
  await setup
    .getByRole("main")
    .getByRole("link", { name: copy.workspace.auth.signIn, exact: true })
    .click();
  await setup
    .getByLabel(copy.workspace.auth.email, { exact: true })
    .fill(email);
  await setup
    .getByLabel(copy.workspace.auth.password, { exact: true })
    .fill(password);
  await formThemes(setup);
  await setup
    .getByRole("button", { name: copy.workspace.auth.signIn, exact: true })
    .click();
  await expect(setup).toHaveURL(/\/home$/);
  await expect(setup.getByRole("heading", { level: 1 })).toHaveText(
    copy.workspace.home.title,
  );
  await expect(
    setup.getByLabel(copy.workspace.navigation.organization),
  ).toHaveAttribute("data-organization-id", (await fixture()).organizationId);
  await page.goto("/admin/users");
  const member = page.getByRole("row").filter({ hasText: email });
  await member.getByRole("combobox").selectOption("admin");
  await page
    .getByRole("dialog")
    .getByLabel(copy.workspace.common.reason, { exact: true })
    .fill("Grant browser verification administration");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: copy.workspace.common.save, exact: true })
    .click();
  await expect(member.getByRole("combobox")).toHaveValue("admin");
  await member
    .getByRole("button", { name: copy.workspace.users.suspend, exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel(copy.workspace.common.reason, { exact: true })
    .fill("Suspend browser verification access");
  await accessible(page);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: copy.workspace.common.save, exact: true })
    .click();
  await expect(
    member.getByRole("button", {
      name: copy.workspace.users.restore,
      exact: true,
    }),
  ).toBeVisible();
  await member
    .getByRole("button", { name: copy.workspace.users.remove, exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel(copy.workspace.common.reason, { exact: true })
    .fill("Remove browser verification membership");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: copy.workspace.users.remove, exact: true })
    .click();
  await expect(member).toHaveCount(0);
  await setup.reload();
  await expect(
    setup.getByRole("heading", {
      name: copy.workspace.navigation.noOrganization,
      exact: true,
    }),
  ).toBeVisible();
  await formThemes(setup);
  await owner.close();
});

// @req R-DASH-01 @req R-DASH-05
test("SQL uses the discovered schema and exports the actual bounded result", async ({
  page,
}) => {
  await page.goto("/sql");
  await page.getByText(copy.workspace.sql.showSchema, { exact: true }).click();
  await page
    .getByLabel(copy.workspace.sql.schemaView, { exact: true })
    .selectOption("sessions");
  const schemaFields = page.locator(".sql-schema-fields");
  await expect(schemaFields).toContainText("session_id");
  await page.getByLabel(copy.workspace.sql.schemaView, { exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(schemaFields).toBeFocused();
  await page.keyboard.press("PageDown");
  await expect
    .poll(() => schemaFields.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  await page
    .getByRole("textbox", { name: copy.workspace.sql.editor })
    .fill("SELECT title FROM sessions ORDER BY started_at ASC LIMIT 2");
  await page.getByRole("textbox", { name: copy.workspace.sql.editor }).focus();
  await page.keyboard.press("Control+Enter");
  await expect(page.getByRole("table")).toContainText("Dashboard verification");
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: copy.workspace.common.export, exact: true })
    .click();
  const path = await (await downloadPromise).path();
  expect((await readFile(path, "utf8")).split(/\r?\n/)).toHaveLength(3);
  await page
    .getByRole("textbox", { name: copy.workspace.sql.editor })
    .fill(
      "SELECT 1 AS duplicate, 1 AS duplicate, NULL AS empty, '=1+1' AS formula",
    );
  await page.getByRole("textbox", { name: copy.workspace.sql.editor }).focus();
  await page.keyboard.press("Control+Enter");
  await expect(
    page.getByRole("columnheader", { name: "duplicate", exact: true }),
  ).toHaveCount(2);
  const duplicateDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: copy.workspace.common.export, exact: true })
    .click();
  const duplicateCsv = Papa.parse<string[]>(
    await readFile(await (await duplicateDownload).path(), "utf8"),
  );
  expect(duplicateCsv.errors).toEqual([]);
  expect(duplicateCsv.data).toEqual([
    ["duplicate", "duplicate", "empty", "formula"],
    ["1", "1", "", "'=1+1"],
  ]);
  await accessible(page);
});

// @req R-DASH-04
test("live ingest reaches the transcript through SSE and its polling fallback", async ({
  page,
  request,
}, info) => {
  const data = await fixture();
  for (const fallback of [false, true]) {
    if (fallback)
      await page.route("**/api/v1/sessions/*/events", (route) =>
        route.abort("connectionfailed"),
      );
    await page.goto(`/s/${data.sessionId}`);
    await expect(
      page.getByText(
        fallback ? copy.workspace.detail.polling : copy.workspace.detail.live,
        { exact: true },
      ),
    ).toBeVisible();
    await page
      .getByLabel(copy.workspace.detail.followLatest, { exact: true })
      .check();
    const text = `Live browser arrival ${info.project.name} ${String(fallback)} ${String(Date.now())}`;
    const pos = Date.now();
    const envelope = ingestEnvelopeSchema.parse({
      ...data.liveEnvelope,
      batchId: randomUUID(),
      sentAt: new Date().toISOString(),
      sourcePos: pos,
      records: [
        {
          pos,
          sourceVersion: 0,
          key: randomUUID(),
          line: JSON.stringify({
            type: "user",
            uuid: randomUUID(),
            timestamp: new Date().toISOString(),
            message: { content: [{ type: "text", text }] },
          }),
        },
      ],
      cursor: `${String(pos)}:0`,
    });
    const response = await request.post("/api/v1/ingest", {
      headers: { authorization: `Bearer ${data.ingestKey}` },
      data: envelope,
    });
    expect(response.status()).toBe(202);
    await expect(page.locator(".transcript-message.selected")).toContainText(
      text,
      {
        timeout: 15_000,
      },
    );
  }
});

// @req R-DASH-12
test("raw download reassembles a real oversized record through bounded cursor pages", async ({
  page,
}) => {
  const data = await fixture();
  await page.goto(`/s/${data.sessionId}`);
  await page
    .getByRole("tab", { name: copy.workspace.detail.raw, exact: true })
    .click();
  const card = page.locator(".raw-record").filter({ hasText: "future_record" });
  await card.locator("summary").click();
  await expect(
    card.getByText(copy.workspace.detail.rawContinued, { exact: false }),
  ).toBeVisible();
  const downloaded = page.waitForEvent("download");
  await card
    .getByRole("button", {
      name: copy.workspace.detail.rawDownload,
      exact: true,
    })
    .click();
  const content = JSON.parse(
    await readFile(await (await downloaded).path(), "utf8"),
  ) as unknown;
  expect(z.object({ text: z.string() }).parse(content).text).toBe(
    "Long raw record browser verification. ".repeat(4000),
  );
});

// @req R-DASH-01 @req R-DASH-05
test("redaction policies validate, scan text, and report durable rescan completion", async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  const name = `browser-rule-${info.project.name}-${String(Date.now())}`;
  await page.goto("/admin/redaction");
  await page
    .getByRole("button", { name: copy.workspace.redaction.create, exact: true })
    .click();
  await page
    .getByRole("textbox", { name: copy.workspace.fields.name, exact: true })
    .fill(name);
  await page
    .getByRole("textbox", { name: copy.workspace.fields.pattern, exact: true })
    .fill("BROWSER_REDACT_[0-9]+");
  await formThemes(page);
  await page
    .getByRole("button", { name: copy.workspace.common.save, exact: true })
    .click();
  await expect(page.getByRole("table")).toContainText(name);
  await page
    .getByLabel(copy.workspace.redaction.testText)
    .fill("Keep the context. BROWSER_REDACT_12345");
  await page
    .getByRole("button", { name: copy.workspace.redaction.test, exact: true })
    .click();
  await expect(page.locator(".redaction-result")).not.toContainText(
    "BROWSER_REDACT_12345",
  );
  await expect(page.locator(".redaction-result")).toContainText(
    "Keep the context.",
  );
  await page
    .getByRole("button", { name: copy.workspace.redaction.rescan, exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel(copy.workspace.common.reason, { exact: true })
    .fill("Verify durable browser rescan progress");
  await accessible(page);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: copy.workspace.redaction.rescan, exact: true })
    .click();
  await expect(page.locator(".rescan-progress")).toContainText(
    copy.workspace.statuses.completed,
    {
      timeout: 120_000,
    },
  );
  const row = page.getByRole("row").filter({ hasText: name });
  await row
    .getByRole("button", { name: copy.workspace.redaction.delete, exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel(copy.workspace.common.reason, { exact: true })
    .fill("Remove the browser verification rule");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: copy.workspace.redaction.delete, exact: true })
    .click();
  await expect(page.getByRole("table")).not.toContainText(name);
});

// @req R-DASH-01 @req R-ORG-03 @req R-WEB-02 @req R-EMB-01 @req R-EMB-04
test("native OIDC sign-in verifies a real local issuer in SSO-only and mixed modes", async ({
  browser,
}, info) => {
  for (const port of [3001, 3003]) {
    const context = await browser.newContext({
      viewport: info.project.use.viewport ?? { width: 1440, height: 1000 },
    });
    const page = await context.newPage();
    await page.goto(`http://localhost:${String(port)}/login`);
    await expect(
      page.getByRole("button", { name: copy.workspace.auth.sso, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", {
        name: copy.workspace.auth.email,
        exact: true,
      }),
    ).toHaveCount(port === 3003 ? 1 : 0);
    await formThemes(page);
    await page
      .getByRole("button", { name: copy.workspace.auth.sso, exact: true })
      .click();
    await expect(page).toHaveURL(/localhost:3002\/interaction\//);
    await page.getByPlaceholder("Enter any login").fill("browser-oidc");
    await page.getByPlaceholder("and password").fill("local-provider-fixture");
    await page.getByRole("button", { name: "Sign-in", exact: true }).click();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page).toHaveURL(`http://localhost:${String(port)}/home`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      copy.workspace.home.title,
    );
    await expect(
      page.getByLabel(copy.workspace.navigation.organization),
    ).toHaveAttribute("data-organization-id", (await fixture()).organizationId);
    await accessible(page);
    const data = await fixture();
    if (port === 3003) {
      await expect
        .poll(
          async () => {
            const response = await page.request.get(
              `http://localhost:3003/api/v1/sessions/${data.sessionId}/similar?max_rows=5`,
            );
            expect(response.ok()).toBe(true);
            return similarOutputSchema.parse(await response.json()).sessions
              .length;
          },
          { timeout: 60_000 },
        )
        .toBeGreaterThan(0);
    }
    await page.goto(`http://localhost:${String(port)}/s/${data.sessionId}`);
    await expect(page.locator(".transcript-message").first()).toBeVisible();
    const panel = page.getByRole("region", {
      name: copy.workspace.detail.similar,
      exact: true,
    });
    if (port === 3003) {
      const response = await page.request.get(
        `http://localhost:3003/api/v1/sessions/${data.sessionId}/similar?max_rows=5`,
      );
      const similar = similarOutputSchema.parse(await response.json());
      await expect(panel.getByRole("link")).toHaveCount(
        similar.sessions.length,
      );
      for (const session of similar.sessions) {
        await expect(
          panel.locator(`a[href="/s/${session.session_id}"]`),
        ).toHaveText(session.title ?? copy.workspace.sessions.untitled);
      }
      await expect(
        panel.locator(`a[href="/s/${data.foreignSessionId}"]`),
      ).toHaveCount(0);
      await formThemes(page);
    } else {
      await expect(panel).toHaveCount(0);
    }
    await context.close();
  }
});

// @req R-WEB-03 @req R-WEB-04
test("real public and customer instances serve the correct discovery and indexing rules", async ({
  browser,
  request,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  const customer = await page.goto("http://localhost:3000/");
  expect(customer?.headers()["x-robots-tag"]).toBe(
    "noindex, nofollow, noarchive",
  );
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    copy.hero.title,
  );
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    "noindex,nofollow,noarchive",
  );
  for (const file of ["sitemap.xml", "llms.txt", "llms-full.txt"])
    expect((await request.get(`http://localhost:3000/${file}`)).status()).toBe(
      404,
    );
  await page.goto("http://localhost:3001/");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    "index,follow",
  );
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "http://localhost:3001/",
  );
  const sitemap = await (
    await request.get("http://localhost:3001/sitemap.xml")
  ).text();
  expect(sitemap).toContain("http://localhost:3001/docs");
  expect(sitemap).not.toContain("/sessions");
  const documentation = await (
    await request.get("http://localhost:3001/llms-full.txt")
  ).text();
  expect(documentation).toContain("# AgentCommons");
  expect(documentation).not.toContain("browser-primary");
  const app = await page.goto("http://localhost:3001/sessions");
  expect(app?.headers()["x-robots-tag"]).toBe("noindex, nofollow, noarchive");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    "noindex,nofollow,noarchive",
  );
  await context.close();
});

// @req R-DASH-05 @req R-DASH-01 @req R-WEB-02
test("moderation confirms visibility and purge with a reason on an actual session", async ({
  page,
  request,
  isMobile,
}, info) => {
  const data = await fixture();
  const text = `Browser moderation ${info.project.name} ${String(Date.now())}`;
  const pos = 0;
  const envelope = ingestEnvelopeSchema.parse({
    ...data.liveEnvelope,
    harnessSessionId: randomUUID(),
    batchId: randomUUID(),
    sentAt: new Date().toISOString(),
    sourcePos: pos,
    records: [
      {
        pos,
        sourceVersion: 0,
        key: randomUUID(),
        line: JSON.stringify({
          type: "user",
          uuid: randomUUID(),
          timestamp: new Date().toISOString(),
          message: { content: [{ type: "text", text }] },
        }),
      },
    ],
    cursor: "1:0",
  });
  const accepted = await request.post("/api/v1/ingest", {
    headers: { authorization: `Bearer ${data.ingestKey}` },
    data: envelope,
  });
  expect(accepted.status()).toBe(202);
  const session = z
    .object({ sessionId: z.uuid() })
    .parse(await accepted.json()).sessionId;
  await waitForSession(request, session, data.ingestKey);
  await page.goto("/admin/moderation");
  await page
    .getByLabel(copy.workspace.sessions.filterField)
    .selectOption("session_id");
  await page.getByLabel(copy.workspace.sessions.filterValue).fill(session);
  await page
    .getByRole("button", {
      name: copy.workspace.sessions.addFilter,
      exact: true,
    })
    .click();
  const row = page.getByRole("row").filter({ hasText: text });
  const privateAction = row.getByRole("button", {
    name: copy.workspace.moderation.private,
    exact: true,
  });
  await privateAction.focus();
  await expect(privateAction).toBeFocused();
  if ((page.viewportSize()?.width ?? 1440) <= 390) {
    expect(
      await page
        .locator(".table-scroll")
        .evaluate((element) => element.scrollLeft),
    ).toBe(0);
    expect((await privateAction.boundingBox())?.height).toBeGreaterThanOrEqual(
      44,
    );
    expect(
      await page
        .locator(".table-scroll")
        .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
    ).toBe(true);
  }
  if (isMobile) {
    await privateAction.tap();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: copy.workspace.common.cancel, exact: true })
      .tap();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await privateAction.focus();
  }
  await page.keyboard.press("Enter");
  let dialog = page.getByRole("dialog");
  await dialog
    .getByLabel(copy.workspace.common.reason, { exact: true })
    .fill("Hide browser verification content");
  await accessible(page);
  await dialog
    .getByRole("button", { name: copy.workspace.common.save, exact: true })
    .click();
  await expect(
    row.getByRole("button", {
      name: copy.workspace.moderation.private,
      exact: true,
    }),
  ).toBeDisabled();
  await row
    .getByRole("button", {
      name: copy.workspace.moderation.visible,
      exact: true,
    })
    .click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByLabel(copy.workspace.common.reason, { exact: true })
    .fill("Restore browser verification content");
  await dialog
    .getByRole("button", { name: copy.workspace.common.save, exact: true })
    .click();
  await expect(
    row.getByRole("button", {
      name: copy.workspace.moderation.visible,
      exact: true,
    }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: copy.theme.light, exact: true })
    .click();
  await row
    .getByRole("button", { name: copy.workspace.moderation.purge, exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("button", {
      name: copy.workspace.moderation.purge,
      exact: true,
    }),
  ).toBeDisabled();
  await dialog
    .getByLabel(copy.workspace.common.reason, { exact: true })
    .fill("Purge disposable browser verification content");
  await accessible(page);
  await dialog
    .getByRole("button", { name: copy.workspace.moderation.purge, exact: true })
    .click();
  await expect(row).toHaveCount(0);
  const tombstone = page.getByRole("row").filter({
    has: page.locator(`a[href="/s/${session}"]`),
  });
  await expect(tombstone).toContainText(copy.workspace.sessions.untitled);
  await expect(tombstone).not.toContainText(text);
  const raw = await request.get(`/api/v1/sessions/${session}/raw`, {
    headers: { authorization: `Bearer ${data.ingestKey}` },
  });
  expect(raw.status()).toBe(200);
  expect(rawOutputSchema.parse(await raw.json())).toEqual({
    items: [],
    cursor: null,
  });
});

// @req R-DASH-05
test("every admin table exports its real caller-visible rows", async ({
  page,
}) => {
  for (const path of [
    "/admin/users",
    "/admin/keys",
    "/admin/audit",
    "/admin/moderation",
    "/admin/redaction",
  ]) {
    await page.goto(path);
    await expect(page.getByRole("table")).toBeVisible();
    const downloaded = page.waitForEvent("download");
    await page
      .getByRole("button", { name: copy.workspace.common.export, exact: true })
      .click();
    const csv = await readFile(await (await downloaded).path(), "utf8");
    const parsed = Papa.parse(csv, { header: true });
    expect(parsed.errors).toEqual([]);
    expect(parsed.data.length).toBeGreaterThan(0);
    expect(parsed.meta.fields).not.toContain(copy.workspace.common.actions);
    expect(csv).not.toContain("browser-secondary@example.com");
  }
});

// @req R-DASH-06
test("a server page renders a bounded number of virtual rows while scrolling", async ({
  page,
}) => {
  await page.goto("/sessions");
  const grid = page.getByRole("region", {
    name: copy.workspace.sessions.list,
    exact: true,
  });
  await expect(grid.locator("tbody .table-cell-title").first()).toBeVisible();
  const first = await grid
    .locator("tbody .table-cell-title")
    .first()
    .getAttribute("href");
  const rendered = () => grid.locator("tbody tr:not([aria-hidden])").count();
  expect(await rendered()).toBeLessThan(50);
  await grid.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(grid.locator(`a[href="${first ?? ""}"]`)).toHaveCount(0);
  await expect.poll(rendered).toBeLessThan(50);
  await expect(
    page.getByRole("button", { name: copy.workspace.common.next, exact: true }),
  ).toBeEnabled();
});

// @req R-DASH-09 @req R-WEB-02
test("workspace navigation contains the specified operations and no command palette", async ({
  page,
  isMobile,
}) => {
  await page.goto("/sessions");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    copy.workspace.sessions.title,
  );
  const menu = page.getByRole("button", {
    name: copy.workspace.navigation.menu,
    exact: true,
  });
  if (await menu.isVisible()) {
    if (isMobile) await menu.tap();
    else await menu.click();
  }
  const navigation = page.getByRole("navigation", {
    name: copy.workspace.navigation.label,
    exact: true,
  });
  await expect(navigation.getByRole("link")).toHaveText([
    copy.workspace.navigation.home,
    copy.workspace.navigation.sessions,
    copy.workspace.navigation.installation,
    copy.workspace.navigation.sql,
    copy.workspace.navigation.keys,
    copy.workspace.navigation.docs,
    copy.workspace.navigation.users,
    copy.workspace.navigation.adminKeys,
    copy.workspace.navigation.audit,
    copy.workspace.navigation.moderation,
    copy.workspace.navigation.redaction,
    copy.workspace.navigation.status,
  ]);
  const sqlLink = navigation.getByRole("link", {
    name: copy.workspace.navigation.sql,
    exact: true,
  });
  if (isMobile) await sqlLink.tap();
  else await sqlLink.click();
  await expect(page).toHaveURL("/sql");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  if (isMobile) {
    await menu.tap();
    await page
      .getByRole("button", {
        name: copy.workspace.navigation.closeMenu,
        exact: true,
      })
      .tap();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await menu.tap();
  }
  const sessionsLink = navigation.getByRole("link", {
    name: copy.workspace.navigation.sessions,
    exact: true,
  });
  if (isMobile) await sessionsLink.tap();
  else await sessionsLink.click();
  await expect(page).toHaveURL("/sessions");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  if (isMobile) await menu.tap();
  if (await page.getByRole("dialog").count())
    await page.keyboard.press("Escape");
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    copy.workspace.sessions.title,
  );
});

// @req R-DASH-07
test("a pending real list request shows a skeleton and then its server rows", async ({
  page,
}) => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let received = () => {};
  const pending = new Promise<void>((resolve) => {
    received = resolve;
  });
  await page.route("**/api/v1/sessions?*", async (route) => {
    received();
    await gate;
    await route.continue();
  });
  try {
    await page.goto("/sessions");
    await pending;
    await expect(page.locator(".loading-state")).toContainText(
      copy.workspace.common.loading,
    );
    await expect(page.locator(".loading-skeleton")).toBeVisible();
    await expect(page.locator(".table-cell-title")).toHaveCount(0);
    release();
    await expect(page.locator(".table-cell-title").first()).toBeVisible();
    await expect(page.locator(".loading-skeleton")).toHaveCount(0);
  } finally {
    release();
  }
});

// @req R-DASH-10
// Actual persisted native metadata exceeds the response preview boundary.
test("shortened response metadata is labeled in transcript and search results", async ({
  page,
  request,
}) => {
  const data = await fixture();
  const text = `metadatafixture${randomUUID().replaceAll("-", "")}`;
  const records = [
    {
      type: "user",
      uuid: randomUUID(),
      message: { content: [{ type: "text", text }] },
    },
    {
      type: "assistant",
      uuid: randomUUID(),
      message: {
        model: `browser-model-${"x".repeat(512)}`,
        content: [
          {
            type: "tool_use",
            id: `browser-use-${"y".repeat(512)}`,
            name: `BrowserTool${"z".repeat(512)}`,
            input: { query: text },
          },
        ],
      },
    },
  ];
  const accepted = await request.post("/api/v1/ingest", {
    headers: { authorization: `Bearer ${data.ingestKey}` },
    data: ingestEnvelopeSchema.parse({
      ...data.liveEnvelope,
      harnessSessionId: randomUUID(),
      batchId: randomUUID(),
      sentAt: new Date().toISOString(),
      sourcePos: 1,
      records: records.map((record, pos) => ({
        pos,
        sourceVersion: 0,
        key: record.uuid,
        line: JSON.stringify(record),
      })),
      cursor: "2:0",
    }),
  });
  expect(accepted.status()).toBe(202);
  const id = z
    .object({ sessionId: z.uuid() })
    .parse(await accepted.json()).sessionId;
  await waitForSession(request, id, data.ingestKey);
  await page.goto(`/s/${id}#1`);
  const notice = page.locator(".transcript-message.selected .shortened-fields");
  await expect(notice).toContainText(copy.workspace.fields.tool_name);
  await expect(notice).toContainText(copy.workspace.fields.model);
  await expect(notice).toContainText(copy.workspace.detail.metadataFull);
  await accessible(page);
  await page.goto("/sessions");
  await page
    .getByRole("searchbox", { name: copy.workspace.common.search, exact: true })
    .fill(text);
  await page
    .getByRole("button", { name: copy.workspace.sessions.search, exact: true })
    .click();
  const block = page
    .locator(".search-block")
    .filter({ has: page.locator(`a[href="/s/${id}"]`) });
  await expect(block.locator(":scope > .shortened-fields")).toContainText(
    copy.workspace.fields.model,
  );
  await expect(
    block.locator(".search-message .shortened-fields"),
  ).toContainText(copy.workspace.fields.tool_name);
  await accessible(page);
});

// @req R-DASH-03
// A new deep link must not reuse the previous page's bounded continuation cursor.
test("a message deep link resets transcript pagination", async ({
  page,
  request,
}) => {
  const data = await fixture();
  const records = Array.from({ length: 150 }, (_, pos) => ({
    pos,
    sourceVersion: 0,
    key: randomUUID(),
    line: JSON.stringify({
      type: "user",
      uuid: randomUUID(),
      message: {
        content: [
          {
            type: "text",
            text: `Transcript pagination ${String(pos)} ${"context ".repeat(60)}`,
          },
        ],
      },
    }),
  }));
  const accepted = await request.post("/api/v1/ingest", {
    headers: { authorization: `Bearer ${data.ingestKey}` },
    data: ingestEnvelopeSchema.parse({
      ...data.liveEnvelope,
      harnessSessionId: randomUUID(),
      batchId: randomUUID(),
      sentAt: new Date().toISOString(),
      sourcePos: 149,
      records,
      cursor: "150:0",
    }),
  });
  expect(accepted.status()).toBe(202);
  const id = z
    .object({ sessionId: z.uuid() })
    .parse(await accepted.json()).sessionId;
  await waitForSession(request, id, data.ingestKey);
  await page.goto(`/s/${id}`);
  await page
    .getByRole("button", { name: copy.workspace.detail.next, exact: true })
    .click();
  const link = page.locator(".transcript-message-header a").nth(1);
  await expect(link).toBeVisible();
  const hash = await link.getAttribute("href");
  expect(hash).toMatch(/^#\d+$/);
  await link.click();
  await expect(page.locator(".transcript-message.selected")).toHaveAttribute(
    "id",
    (hash ?? "").slice(1),
  );
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".transcript-message.selected")).toHaveAttribute(
    "id",
    (hash ?? "").slice(1),
  );
});

// @req R-ORG-10 @req R-DASH-07
test("an unselected organization uses a neutral picker placeholder", async ({
  browser,
}, info) => {
  const data = await fixture();
  const context = await browser.newContext({
    viewport: info.project.use.viewport ?? { width: 1440, height: 1000 },
  });
  try {
    const page = await context.newPage();
    await page.goto("http://localhost:3000/login");
    await page
      .getByLabel(copy.workspace.auth.email, { exact: true })
      .fill(data.ownerEmail);
    await page
      .getByLabel(copy.workspace.auth.password, { exact: true })
      .fill(testAccountPassword);
    await page
      .getByRole("button", { name: copy.workspace.auth.signIn, exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: copy.workspace.navigation.chooseOrganization,
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByLabel(copy.workspace.navigation.organization),
    ).toHaveText(copy.workspace.navigation.selectOrganization);
    await formThemes(page);
    await selectOrganization(page, data.organizationId);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      copy.workspace.home.title,
    );
  } finally {
    await context.close();
  }
});

// @req R-ORG-08 @req R-ORG-10 @req R-DASH-07
test("member admin routes show a permission page without forbidden data requests", async ({
  page,
}) => {
  const data = await fixture();
  const switched = await page.request.post("/api/v1/me/organization", {
    headers: { origin: "http://localhost:3000" },
    data: { organization_id: data.secondaryOrganizationId },
  });
  expect(switched.ok()).toBe(true);
  const forbidden: string[] = [];
  const errors: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/v1/admin/"))
      forbidden.push(request.url());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  for (const route of [
    "users",
    "keys",
    "audit",
    "moderation",
    "redaction",
    "status",
  ]) {
    await page.goto(`/admin/${route}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      copy.workspace.navigation.adminRequired,
    );
    await expect(page.getByRole("table")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: copy.workspace.users.add, exact: true }),
    ).toHaveCount(0);
  }
  await formThemes(page);
  await page
    .getByRole("link", {
      name: copy.workspace.navigation.sessions,
      exact: true,
    })
    .last()
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    copy.workspace.sessions.title,
  );
  expect(forbidden).toEqual([]);
  expect(errors).toEqual([]);
});

// @req R-EMB-01 @req R-DASH-07
test("status cards follow the instance embedding feature flag", async ({
  page,
}) => {
  for (const [port, enabled] of [
    [3001, false],
    [3000, true],
  ] as const) {
    await page.goto(`http://localhost:${String(port)}/admin/status`);
    const snapshot = page.locator(".metric-section").filter({
      has: page.getByRole("heading", {
        name: copy.workspace.systemStatus.snapshot,
        exact: true,
      }),
    });
    await expect(snapshot.locator(".status-metrics dt").first()).toHaveText(
      copy.workspace.systemStatus.queue,
    );
    await expect(snapshot.locator(".status-metrics dt")).toHaveText([
      copy.workspace.systemStatus.queue,
      ...(enabled
        ? [
            copy.workspace.systemStatus.backlog,
            copy.workspace.systemStatus.tokens,
            copy.workspace.systemStatus.cost,
          ]
        : []),
    ]);
    await formThemes(page);
  }
});

// @req R-DASH-07 @req R-WEB-02
for (const theme of ["dark", "light"] as const)
  test(`dashboard visual baselines in ${theme}`, async ({ page, context }) => {
    const data = await fixture();
    await installVisualTime(page, data.visual.timeShiftMs);
    await context.clearCookies();
    await context.addCookies(data.visual.storageState.cookies);
    await page.addInitScript((value) => {
      localStorage.setItem("agentcommons-theme", value);
    }, theme);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    const dynamicColumns = new Set<string>([
      copy.workspace.fields.id,
      copy.workspace.fields.organization_id,
      copy.workspace.fields.installation_id,
      copy.workspace.fields.last_seen_at,
      copy.workspace.fields.user_id,
      copy.workspace.fields.api_key_id,
      copy.workspace.fields.prefix,
      copy.workspace.fields.request_id,
      copy.workspace.fields.resource_ids,
      copy.workspace.fields.duration_ms,
      copy.workspace.fields.created_at,
      copy.workspace.fields.updated_at,
      copy.workspace.fields.last_used_at,
      copy.workspace.fields.ts,
    ]);
    // Use the product's column chooser for a stable supported view. Native IDs,
    // prefixes and receipt clocks remain covered by the functional matrix.
    for (const [name, path] of [
      ["home", "/home"],
      ["installation", "/installation"],
      ["sessions", "/sessions"],
      ["session", `/s/${data.visual.sessionId}`],
      ["sql", "/sql"],
      ["keys", "/keys"],
      ["users", "/admin/users"],
      ["admin-keys", "/admin/keys"],
      ["audit", "/admin/audit"],
      ["moderation", "/admin/moderation"],
      ["redaction", "/admin/redaction"],
      ["status", "/admin/status"],
      ["login", "/login"],
      ["password-setup", data.visual.setupUrl],
    ]) {
      if (!name || !path) throw new Error("Expected a baseline route.");
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.locator(".loading-state")).toHaveCount(0);
      if (name === "audit") {
        await page
          .getByText(copy.workspace.audit.filters, { exact: true })
          .click();
        await page
          .getByRole("textbox", {
            name: copy.workspace.fields.action,
            exact: true,
          })
          .fill("ingest");
        await page
          .getByRole("button", {
            name: copy.workspace.common.apply,
            exact: true,
          })
          .click();
        await expect(
          page.getByRole("table").getByText("ingest", { exact: true }),
        ).toHaveCount(3);
        await page
          .getByText(copy.workspace.audit.filters, { exact: true })
          .click();
      }
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(
        page.getByRole("button", {
          name: theme === "dark" ? copy.theme.light : copy.theme.dark,
          exact: true,
        }),
      ).toBeVisible();
      if (name === "session")
        await expect(page.locator(".shiki")).toBeVisible();
      await accessible(page);
      await expect(page.getByRole("alert")).toHaveCount(0);
      for (const table of await page.locator(".data-table").all()) {
        const chooser = page.getByRole("dialog");
        const labels = (await table.locator("thead th").allTextContents())
          .map((label) => label.trim())
          .filter((label) => dynamicColumns.has(label));
        if (labels.length) {
          await table
            .getByRole("button", {
              name: copy.workspace.common.columns,
              exact: true,
            })
            .click();
          for (const label of labels)
            await chooser
              .getByRole("checkbox", { name: label, exact: true })
              .uncheck();
          await chooser
            .getByRole("button", {
              name: copy.workspace.common.close,
              exact: true,
            })
            .click();
        }
      }
      await page.evaluate(() => {
        scrollTo(0, 0);
      });
      await expect(page).toHaveScreenshot(`${name}-${theme}.png`);
    }
    expect(errors).toEqual([]);
  });

// @req R-DASH-13 @req R-WEB-02
test("Status filters operational health and exports its rows without duplicating Home", async ({
  page,
}) => {
  await page.goto("/admin/status");
  await expect(
    page.getByRole("region", {
      name: copy.workspace.systemStatus.groups.usage,
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("region", {
      name: copy.workspace.searchAdoption.title,
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(page.locator(".reuse-headline")).toHaveCount(0);
  const health = page.getByRole("region", {
    name: copy.workspace.systemStatus.groups.health,
    exact: true,
  });
  await page
    .getByRole("textbox", {
      name: copy.workspace.systemStatus.repo,
      exact: true,
    })
    .fill("github.com/rek7/agentcommons");
  await page
    .getByRole("form", { name: copy.workspace.systemStatus.dateFilters })
    .getByRole("button", { name: copy.workspace.common.apply, exact: true })
    .click();
  await health
    .getByRole("combobox", {
      name: copy.workspace.systemStatus.metric,
      exact: true,
    })
    .selectOption("sessions");
  await expect(health.locator(".metric-plot figcaption span")).toHaveText(
    copy.workspace.systemStatus.units.count,
  );
  await expect(health.locator(".metric-scope")).toContainText(
    "github.com/rek7/agentcommons",
  );
  await health.locator(".metric-data > summary").click();
  const download = page.waitForEvent("download");
  await health
    .getByRole("button", { name: copy.workspace.common.export, exact: true })
    .click();
  const csv = Papa.parse<Record<string, string>>(
    await readFile(await (await download).path(), "utf8"),
    { header: true, skipEmptyLines: true },
  );
  expect(csv.errors).toEqual([]);
  expect(csv.data.length).toBeGreaterThan(0);
  expect(
    csv.data.every(
      (row) =>
        row[copy.workspace.systemStatus.dimensions.metric] === "sessions" &&
        row[copy.workspace.systemStatus.dimensions.repo_name] ===
          "github.com/rek7/agentcommons",
    ),
  ).toBe(true);
  await page
    .getByRole("textbox", {
      name: copy.workspace.systemStatus.repo,
      exact: true,
    })
    .fill("no-such-browser-repository");
  await page
    .getByRole("form", { name: copy.workspace.systemStatus.dateFilters })
    .getByRole("button", { name: copy.workspace.common.apply, exact: true })
    .click();
  await expect(health.locator(".metric-scope")).toContainText(
    "no-such-browser-repository",
  );
  await health.locator(".metric-data > summary").click();
  await expect(
    health.getByRole("button", {
      name: copy.workspace.common.export,
      exact: true,
    }),
  ).toBeDisabled();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await formThemes(page);
});

// @req R-DASH-14 @req R-DASH-13 @req R-WEB-02
test("installation rollout requires reasons and exposes both outcome groups", async ({
  page,
}) => {
  const data = await fixture();
  await page.goto("/admin/status");
  const rollout = page.getByRole("region", {
    name: copy.workspace.systemStatus.installations,
    exact: true,
  });
  const row = rollout.getByRole("row").filter({ hasText: "reuse-workstation" });
  await expect(row).toHaveCount(1);
  await row
    .getByRole("button", {
      name: copy.workspace.systemStatus.disableTools,
      exact: true,
    })
    .click();
  let dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("button", {
      name: copy.workspace.systemStatus.disableTools,
      exact: true,
    }),
  ).toBeDisabled();
  await dialog
    .getByLabel(copy.workspace.common.reason, { exact: true })
    .fill("Compare browser installation outcomes");
  await dialog
    .getByRole("button", {
      name: copy.workspace.systemStatus.disableTools,
      exact: true,
    })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(row).toContainText(copy.workspace.systemStatus.toolsDisabled);
  const outcomeFilters = new URLSearchParams({
    filters: JSON.stringify({
      date_from: "2020-01-01T00:00:00.000Z",
      date_to: "2100-01-01T00:00:00.000Z",
      metric: "tool_calls_per_session",
    }),
  });
  const outcomeResponse = await page.request.get(
    `/api/v1/admin/metrics/outcomes?${outcomeFilters.toString()}`,
  );
  expect(outcomeResponse.ok()).toBe(true);
  const outcomes = z
    .object({
      items: z.array(z.object({ tools_enabled: z.boolean().nullable() })),
    })
    .parse(await outcomeResponse.json());
  expect(new Set(outcomes.items.map((item) => item.tools_enabled))).toEqual(
    new Set([true, false]),
  );
  await row
    .getByRole("button", {
      name: copy.workspace.systemStatus.enableTools,
      exact: true,
    })
    .click();
  dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("button", {
      name: copy.workspace.systemStatus.enableTools,
      exact: true,
    }),
  ).toBeDisabled();
  await dialog
    .getByLabel(copy.workspace.common.reason, { exact: true })
    .fill("Finish browser comparison");
  await dialog
    .getByRole("button", {
      name: copy.workspace.systemStatus.enableTools,
      exact: true,
    })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(row).toContainText(copy.workspace.systemStatus.toolsEnabled);
  await rollout
    .getByRole("textbox", {
      name: copy.workspace.fields.installation_hostname,
      exact: true,
    })
    .fill("reuse-workstation");
  await rollout
    .getByRole("button", { name: copy.workspace.common.apply, exact: true })
    .click();
  await expect(rollout.getByRole("row")).toHaveCount(2);
  const sorted = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return (
      url.pathname === "/api/v1/installations" &&
      url.searchParams.get("order") === "asc"
    );
  });
  await rollout
    .getByRole("button", {
      name: copy.workspace.common.sortDescending,
      exact: true,
    })
    .click();
  expect(
    new URL((await sorted).url()).searchParams.get("filters[hostname]"),
  ).toBe("reuse-workstation");
  const installations = await page.request.get(
    "/api/v1/installations?limit=100",
  );
  const result = z
    .object({
      items: z.array(
        z.object({ installation_id: z.uuid(), tools_enabled: z.boolean() }),
      ),
    })
    .parse(await installations.json());
  expect(
    result.items.find(
      (item) => item.installation_id === data.reuse.installationId,
    )?.tools_enabled,
  ).toBe(true);
  await formThemes(page);
});

// @req R-DASH-17 @req R-WEB-02
test("session reuse follows actual cross-user reads in both directions", async ({
  page,
}) => {
  const data = await fixture();
  await page.goto(`/s/${data.reuse.targetSessionId}`);
  const inbound = page.locator("section").filter({
    has: page.getByRole("heading", {
      name: copy.workspace.detail.reusedBy,
      exact: true,
    }),
  });
  await expect(
    inbound.locator(`a[href="/s/${data.reuse.sourceSessionId}"]`),
  ).toBeVisible();
  await expect(inbound).toContainText(data.reuse.userEmail);
  await inbound
    .getByRole("textbox", {
      name: copy.workspace.detail.readerUserId,
      exact: true,
    })
    .fill(data.reuse.readerUserId);
  await inbound
    .getByRole("button", { name: copy.workspace.common.apply, exact: true })
    .click();
  await expect(inbound.getByRole("row")).toHaveCount(2);
  const sorted = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return (
      url.pathname.endsWith("/reuse") &&
      url.searchParams.get("sort") === "reader_email"
    );
  });
  await inbound
    .getByRole("combobox", { name: copy.workspace.common.sortBy, exact: true })
    .selectOption("reader_email");
  expect(new URL((await sorted).url()).searchParams.get("reader_user_id")).toBe(
    data.reuse.readerUserId,
  );
  const download = page.waitForEvent("download");
  await inbound
    .getByRole("button", { name: copy.workspace.common.export, exact: true })
    .click();
  const exported = await readFile(await (await download).path(), "utf8");
  expect(exported).toContain(data.reuse.readerUserId);

  await inbound.locator(`a[href="/s/${data.reuse.sourceSessionId}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/s/${data.reuse.sourceSessionId}$`));
  const outbound = page.locator("section").filter({
    has: page.getByRole("heading", {
      name: copy.workspace.detail.reusedFrom,
      exact: true,
    }),
  });
  await expect(
    outbound.locator(`a[href="/s/${data.reuse.targetSessionId}"]`),
  ).toBeVisible();
  await formThemes(page);
  await page.goto("/sessions");
  await page
    .getByRole("button", { name: copy.workspace.common.columns, exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("checkbox", {
      name: copy.workspace.fields.reuse_count,
      exact: true,
    })
    .check();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: copy.workspace.common.close, exact: true })
    .click();
  await expect(
    page.getByRole("columnheader", {
      name: copy.workspace.fields.reuse_count,
      exact: true,
    }),
  ).toHaveCount(1);
});

async function runWorkspaceSql(page: Page, sql: string) {
  await page.goto("http://localhost:3000/sql");
  const editor = page.getByRole("textbox", { name: copy.workspace.sql.editor });
  await editor.focus();
  await editor.press("ControlOrMeta+A");
  await editor.pressSequentially(sql);
  await editor.press("Escape");
  await page
    .getByRole("button", { name: copy.workspace.sql.run, exact: true })
    .click();
  await expect(page.getByRole("table")).toBeVisible();
}

// @req R-DASH-16 @req R-DASH-15 @req R-ORG-10 @req R-WEB-02
test("Home shows only the selected dashboard and native SQL keeps search gaps private", async ({
  page,
  browser,
}, info) => {
  const data = await fixture();
  await page.goto("/home");
  await expect(
    page.getByRole("heading", { name: copy.workspace.home.title, exact: true }),
  ).toBeVisible();
  const summary = page.getByRole("region", {
    name: copy.workspace.home.currentWeek,
    exact: true,
  });
  await expect(summary.locator(".home-summary-grid > div")).toHaveCount(4);
  await expect(
    summary
      .locator(".home-summary-grid > div")
      .filter({ hasText: copy.workspace.home.reusedSessions })
      .locator("dd"),
  ).toHaveText(/[1-9]\d*/);
  await expect(page.locator(".home-insights")).toHaveCount(0);
  await expect(
    page.getByLabel(copy.workspace.profiles.selector, { exact: true }),
  ).toBeVisible();
  await formThemes(page);
  const sql =
    "SELECT query FROM metrics_own_zero_results ORDER BY searched_at DESC";
  await runWorkspaceSql(page, sql);
  await expect(page.getByRole("table")).toContainText(
    "missing-owner-only-browser-evidence-8c2f",
  );
  await expect(page.getByRole("table")).not.toContainText(
    "missing-browser-reuse-evidence-7f9a",
  );
  const member = await browser.newContext({
    viewport: info.project.use.viewport ?? { width: 390, height: 844 },
  });
  try {
    await member.addCookies(data.reuse.storageState.cookies);
    const memberPage = await member.newPage();
    await memberPage.goto("http://localhost:3000/home");
    await runWorkspaceSql(memberPage, sql);
    await expect(memberPage.getByRole("table")).toContainText(
      "missing-browser-reuse-evidence-7f9a",
    );
    await expect(memberPage.getByRole("table")).not.toContainText(
      "missing-owner-only-browser-evidence-8c2f",
    );
    const download = memberPage.waitForEvent("download");
    await memberPage
      .getByRole("button", { name: copy.workspace.common.export, exact: true })
      .click();
    const csv = await readFile(await (await download).path(), "utf8");
    expect(csv).toContain("missing-browser-reuse-evidence-7f9a");
    expect(csv).not.toContain("missing-owner-only-browser-evidence-8c2f");
    await formThemes(memberPage);
  } finally {
    await member.close();
  }
});

// @req R-DASH-18 @req R-ORG-10 @req R-WEB-02 @req R-DASH-02
test("transcript search adoption counts attempts, respects visibility, and exports Usage", async ({
  page,
  context,
}, info) => {
  const data = await fixture();
  await context.clearCookies();
  await context.addCookies(data.adoption.ownerStorageState.cookies);
  await page.goto("/home");
  await selectOrganization(page, data.adoption.organizationId);
  const metric = (label: string) =>
    page
      .locator(".home-summary-grid > div")
      .filter({ hasText: label })
      .locator("dd");
  await expect(metric(copy.workspace.home.searchedSessions)).toHaveText("2");
  const sql =
    "SELECT count() AS sessions,countIf(agentcommons_search_calls>0) AS searched_sessions,sum(agentcommons_search_calls) AS calls,sum(repeat_agentcommons_search_calls) AS repeat_calls,sum(subsequent_other_search_calls) AS later_calls FROM metrics_search_sessions";
  const counts = async (values: string[]) => {
    await runWorkspaceSql(page, sql);
    const details = page
      .getByRole("table")
      .getByRole("row")
      .nth(1)
      .getByRole("button", {
        name: copy.workspace.common.viewDetails,
        exact: true,
      });
    if (info.project.use.hasTouch) await details.tap();
    else await details.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.locator(".record-fields dd")).toHaveText(values);
    await dialog
      .getByRole("button", { name: copy.workspace.common.close, exact: true })
      .click();
  };
  await counts(["2", "2", "4", "2", "4"]);
  await formThemes(page);
  await page.screenshot({ path: info.outputPath("search-adoption.png") });

  const expected = {
    agentcommons_search_sessions: 2,
    agentcommons_search_rate: 1,
    agentcommons_search_calls: 4,
    repeat_agentcommons_search_calls: 2,
    subsequent_other_search_calls: 4,
  } as const;
  for (const [name, value] of Object.entries(expected)) {
    const query = new URLSearchParams({
      format: "csv",
      filters: JSON.stringify({
        date_from: "2020-01-01T00:00:00.000Z",
        date_to: "2100-01-01T00:00:00.000Z",
        metric: name,
      }),
    });
    const response = await page.request.get(
      `/api/v1/admin/metrics/usage?${query.toString()}`,
    );
    expect(response.ok()).toBe(true);
    const csv = Papa.parse<Record<string, string>>(await response.text(), {
      header: true,
      skipEmptyLines: true,
    });
    expect(csv.errors).toEqual([]);
    expect(csv.data.length).toBeGreaterThan(0);
    expect(csv.data.every((row) => row.metric === name)).toBe(true);
    const values = csv.data.map((row) => Number(row.value));
    expect(
      name === "agentcommons_search_rate"
        ? Math.max(...values)
        : values.reduce((sum, current) => sum + current, 0),
    ).toBe(value);
  }
  await formThemes(page);

  await context.clearCookies();
  await context.addCookies(data.adoption.memberStorageState.cookies);
  await page.goto("/home");
  await expect(metric(copy.workspace.home.searchedSessions)).toHaveText("1");
  await counts(["1", "1", "2", "1", "2"]);
  await formThemes(page);
  await context.clearCookies();
  await context.addCookies(data.adoption.ownerStorageState.cookies);
  await page.goto("/home");
  await selectOrganization(page, data.adoption.emptyOrganizationId);
  await expect(metric(copy.workspace.home.searchedSessions)).toHaveText("0");
  await expect(
    page.getByRole("link", {
      name: copy.workspace.home.setupCapture,
      exact: true,
    }),
  ).toBeVisible();
  await counts(["0", "0", "0", "0", "0"]);
  await formThemes(page);
  await selectOrganization(page, data.adoption.organizationId);
  await counts(["2", "2", "4", "2", "4"]);
});

// @req R-SRCH-13 @req R-WEB-02
test("structured tool conditions search full typed parameters and retain them in CSV exports", async ({
  page,
}, info) => {
  const data = await fixture();
  const labels = copy.workspace.sessions.conditions;
  const identity = randomUUID();
  const toolName = `mcp__FutureVendor_${identity}__Search`;
  const envelope = {
    ...data.liveEnvelope,
    harnessSessionId: identity,
    context: {
      ...data.liveEnvelope.context,
      git: {
        ...data.liveEnvelope.context.git,
        branch: `structured-${identity}`,
      },
    },
    batchId: randomUUID(),
    sourcePos: 0,
    cursor: "1:0",
    behavior: "sync",
    end: null,
    records: [
      {
        pos: 0,
        sourceVersion: 0,
        key: "structured-browser",
        line: JSON.stringify({
          type: "assistant",
          uuid: "structured-browser",
          timestamp: new Date().toISOString(),
          message: {
            content: [
              {
                type: "tool_use",
                id: "browser-condition-call",
                name: toolName,
                input: {
                  padding: "x".repeat(3000),
                  options: { limit: 2, "dot.key": ["Auth%_literal"] },
                },
              },
            ],
          },
        }),
      },
    ],
  };
  const captured = await page.request.post("/api/v1/ingest", {
    headers: {
      authorization: `Bearer ${data.ingestKey}`,
      origin: "http://localhost:3000",
    },
    data: envelope,
  });
  expect(captured.status(), await captured.text()).toBe(202);
  const id = z
    .object({ sessionId: z.uuid() })
    .parse(await captured.json()).sessionId;
  await waitForSession(page.request, id, data.ingestKey);
  await page.goto("/sessions");
  await page.getByText(labels.title, { exact: true }).click();
  await page
    .getByRole("combobox", { name: labels.field, exact: true })
    .selectOption("tool_name");
  await page
    .getByRole("combobox", { name: labels.operator, exact: true })
    .selectOption("contains");
  await page
    .getByLabel(labels.value, { exact: true })
    .fill(toolName.toLowerCase());
  await page.getByRole("button", { name: labels.add, exact: true }).click();
  await expect(page.getByRole("table").locator("tbody tr")).toHaveCount(1);
  await expect(
    page.getByRole("table").locator(`a[href="/s/${id}"]`),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: labels.field, exact: true })
    .selectOption("tool_input");
  await page
    .getByLabel(labels.path, { exact: true })
    .fill('["options", "limit"]');
  await page
    .getByRole("combobox", { name: labels.operator, exact: true })
    .selectOption("eq");
  await page.getByLabel(labels.json, { exact: true }).check();
  await page.getByLabel(labels.value, { exact: true }).fill("2");
  const filtered = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === "/api/v1/sessions" &&
      (url.searchParams.get("filters") ?? "").includes('"value":2')
    );
  });
  await page.getByRole("button", { name: labels.add, exact: true }).click();
  expect((await filtered).status()).toBe(200);
  await expect(page.getByRole("table").locator("tbody tr")).toHaveCount(1);
  const downloaded = page.waitForEvent("download");
  await page
    .getByRole("button", { name: copy.workspace.common.export, exact: true })
    .click();
  const csv = await readFile(await (await downloaded).path(), "utf8");
  const exported = Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: true,
  });
  expect(exported.errors).toEqual([]);
  expect(exported.data).toHaveLength(1);
  expect(exported.data[0]?.[copy.workspace.fields.branch]).toBe(
    `structured-${identity}`,
  );
  await page
    .getByLabel(copy.workspace.common.search, { exact: true })
    .fill("padding");
  const searched = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/v1/search",
  );
  await page
    .getByRole("button", { name: copy.workspace.sessions.search, exact: true })
    .click();
  expect((await searched).status()).toBe(200);
  await expect(page.locator(".search-block")).toHaveCount(1);
  await page
    .getByRole("button", {
      name: copy.workspace.sessions.showList,
      exact: true,
    })
    .click();
  await page.getByLabel(labels.value, { exact: true }).fill('"2"');
  await page.getByRole("button", { name: labels.add, exact: true }).click();
  await expect(page.getByRole("table").locator("tbody tr")).toHaveCount(0);
  const remove = page.getByRole("button", {
    name: `${labels.remove} 3`,
    exact: true,
  });
  if (info.project.name === "desktop") await remove.click();
  else await remove.tap();
  await expect(page.getByRole("table").locator("tbody tr")).toHaveCount(1);
  await formThemes(page);
});
