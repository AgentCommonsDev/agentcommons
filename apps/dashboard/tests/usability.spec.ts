import { test } from "./browser-test";
import { selectOrganization } from "./organization-controls";
import { expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import Papa from "papaparse";
import { randomUUID } from "node:crypto";
import { ingestEnvelopeSchema } from "@agentcommons/core/schemas";
import { schemaOutputSchema } from "@agentcommons/core/schemas/rest";
import { copy } from "../src/copy";

const fixtureSchema = z.object({
  organizationId: z.string(),
  storageState: z.object({
    cookies: z.array(
      z.object({
        name: z.string(),
        value: z.string(),
        domain: z.string(),
        path: z.string(),
        httpOnly: z.boolean(),
        secure: z.boolean(),
        sameSite: z.enum(["Strict", "Lax", "None"]),
      }),
    ),
  }),
});
// @req R-WEB-02 @req R-DASH-06 @req R-ORG-10 @req R-DASH-21 @req R-DASH-22 @req R-DASH-24 @req R-DASH-26
for (const theme of ["light", "dark"] as const)
  test(`responsive ${theme} records, schema and authenticated entry support real controls`, async ({
    page,
    context,
  }, testInfo) => {
    const fixture = fixtureSchema.parse(
      JSON.parse(
        await readFile(
          "/tmp/agentcommons-dashboard-browser-state.json",
          "utf8",
        ),
      ),
    );
    await context.addCookies(fixture.storageState.cookies);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const input = testInfo.project.use.hasTouch ? "tap" : "click";
    await page.goto("/home");
    await selectOrganization(page, fixture.organizationId);
    const organizationPicker = page.getByRole("combobox", {
      name: copy.workspace.navigation.organization,
      exact: true,
    });
    await organizationPicker.focus();
    await organizationPicker.press("Enter");
    await expect(page.getByRole("listbox")).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await expect(organizationPicker).toBeFocused();
    await expect(
      page.getByRole("heading", {
        name: copy.workspace.home.title,
        exact: true,
      }),
    ).toBeVisible();
    const toggle = page.getByRole("button", {
      name: theme === "light" ? copy.theme.light : copy.theme.dark,
      exact: true,
    });
    if (await toggle.count()) await toggle[input]();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await page.goto("/");
    await expect(page).toHaveURL(/\/$/);
    const dashboard = page
      .getByRole("banner")
      .getByRole("link", { name: copy.signup.dashboardShort, exact: true });
    await expect(dashboard).toBeVisible();
    await dashboard[input]();
    await expect(page).toHaveURL(/\/home$/);
    await page.goto("/sessions");
    const columns = page.getByRole("button", {
      name: copy.workspace.common.columns,
      exact: true,
    });
    await columns[input]();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page
      .getByRole("button", {
        name: copy.workspace.common.viewDetails,
        exact: true,
      })
      .first()
      [input]();
    const details = page.getByRole("dialog");
    await expect(
      details.getByText(copy.workspace.fields.branch, { exact: true }),
    ).toBeVisible();
    await expect(
      details.getByText(copy.workspace.fields.observed_commit_count, {
        exact: true,
      }),
    ).toBeVisible();
    expect(
      await details.evaluate(
        (element) => element.scrollWidth <= element.clientWidth + 1,
      ),
    ).toBe(true);
    await details
      .getByRole("button", { name: copy.workspace.common.close, exact: true })
      [input]();
    const download = page.waitForEvent("download");
    await page
      .getByRole("button", { name: copy.workspace.common.export, exact: true })
      [input]();
    const path = await (await download).path();
    if (!path) throw new Error("CSV download did not produce a file.");
    const csv = Papa.parse<string[]>(await readFile(path, "utf8"));
    expect(csv.data[0]).toContain(copy.workspace.fields.branch);
    expect(csv.data[0]).toContain(copy.workspace.fields.observed_commit_count);
    expect(csv.data.length).toBeGreaterThan(1);
    await page.goto("/sql");
    const schema = await context.request.get("/api/v1/schema");
    expect(schema.ok()).toBe(true);
    const schemaData = schemaOutputSchema.parse(await schema.json());
    const firstFunction = schemaData.functions[0];
    if (!firstFunction)
      throw new Error("The canonical schema must expose query functions.");
    const editor = page.getByRole("textbox", {
      name: copy.workspace.sql.editor,
      exact: true,
    });
    await editor.fill("SELECT ( FROM sessions");
    await page
      .getByRole("button", {
        name: copy.workspace.sql.diagnostics,
        exact: true,
      })
      [input]();
    await expect(
      page.getByText(copy.workspace.sql.syntaxError, { exact: true }),
    ).toBeVisible();
    await editor.fill("SELECT 1");
    await expect(
      page.locator(".cm-line span").filter({ hasText: /^SELECT$/ }),
    ).toHaveCSS(
      "color",
      theme === "dark" ? "rgb(184, 161, 255)" : "rgb(112, 66, 172)",
    );
    await editor.fill("");
    await editor.pressSequentially("SEL", { delay: 30 });
    await editor.press("Control+End");
    await page
      .getByRole("button", { name: copy.workspace.sql.complete, exact: true })
      [input]();
    await expect(
      page
        .getByRole("listbox", { name: "Completions" })
        .getByRole("option", { name: "SELECT", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await editor.fill("SELECT arrayMap(x -> x + 1, [1, 2]) AS values");
    await page
      .getByRole("button", {
        name: copy.workspace.sql.diagnostics,
        exact: true,
      })
      [input]();
    await expect(
      page
        .getByRole("listbox", { name: "Diagnostics" })
        .getByRole("option", { name: "No diagnostics", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".cm-lintRange-error")).toHaveCount(0);
    await editor.fill("SELECT * FROM sess");
    await editor.press("Control+End");
    await page
      .getByRole("button", { name: copy.workspace.sql.complete, exact: true })
      [input]();
    const completions = page.getByRole("listbox", { name: "Completions" });
    await expect(
      completions.getByRole("option", { name: "sessions", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(testInfo.project.use.viewport?.width ?? 1440);
    await completions
      .getByRole("option", { name: "sessions", exact: true })
      [input]();
    await expect(editor).toHaveText("SELECT * FROM sessions");
    await page
      .getByRole("button", { name: copy.workspace.sql.complete, exact: true })
      [input]();
    await expect(completions).toBeVisible();
    await editor.press("Control+Enter");
    await expect(completions).toBeHidden();
    await expect(page.locator(".data-table")).toBeVisible();
    await page
      .getByRole("button", { name: copy.workspace.sql.complete, exact: true })
      [input]();
    await expect(completions).toBeVisible();
    await page
      .getByRole("button", { name: copy.workspace.sql.run, exact: true })
      [input]();
    await expect(completions).toBeHidden();
    await editor.fill("SELECT sessions.tit FROM sessions");
    await editor.press("Home");
    await editor.press("ArrowRight");
    // Place the native editor cursor after the incomplete qualified column.
    await editor.press("Control+Home");
    for (let position = 0; position < 19; position++)
      await editor.press("ArrowRight");
    await page
      .getByRole("button", { name: copy.workspace.sql.complete, exact: true })
      [input]();
    await expect(
      completions.locator(".cm-completionLabel").filter({ hasText: /^title$/ }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await editor.fill(`SELECT ${firstFunction.function_name.slice(0, -1)}`);
    await editor.press("Control+End");
    await page
      .getByRole("button", { name: copy.workspace.sql.complete, exact: true })
      [input]();
    await expect(
      completions
        .locator(".cm-completionLabel")
        .filter({ hasText: firstFunction.function_name }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await editor.fill("SELECT missing_browser_column FROM sessions");
    await page
      .getByRole("button", { name: copy.workspace.sql.run, exact: true })
      [input]();
    await expect(page.locator('.sql-workbench [role="alert"]')).toBeVisible();
    await editor.fill("SELECT 1 AS result");
    await expect(page.locator('.sql-workbench [role="alert"]')).toHaveCount(0);
    await editor.press("Tab");
    await expect(editor).not.toBeFocused();
    await page
      .getByRole("button", { name: copy.workspace.sql.copySchema, exact: true })
      [input]();
    expect(
      JSON.parse(await page.evaluate(() => navigator.clipboard.readText())),
    ).toEqual(await schema.json());
    await page
      .getByText(copy.workspace.sql.showSchema, { exact: true })
      [input]();
    await page
      .getByLabel(copy.workspace.sql.schemaView, { exact: true })
      .selectOption("__functions");
    await expect(
      page.getByText(firstFunction.function_name, { exact: false }).first(),
    ).toBeVisible();
    await page
      .getByRole("button", { name: copy.workspace.sql.run, exact: true })
      [input]();
    await expect(page.locator(".data-table")).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);
    expect(
      await page
        .locator(".table-scroll")
        .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
    ).toBe(true);
    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(
      accessibility.violations.filter(
        (item) => item.impact === "serious" || item.impact === "critical",
      ),
    ).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath(`sql-usable-${theme}.png`),
      fullPage: true,
    });
  });

// @req R-DASH-06 @req R-WEB-02 @req R-DASH-23
// The native CLI/served-installer contract is exercised separately by live canaries.
// This browser test verifies the setup controls and a real ingest acknowledgement.
test("Installation creates a scoped key, copies its command, and shows accepted capture", async ({
  page,
  context,
}, testInfo) => {
  const fixture = fixtureSchema.parse(
    JSON.parse(
      await readFile("/tmp/agentcommons-dashboard-browser-state.json", "utf8"),
    ),
  );
  await context.addCookies(fixture.storageState.cookies);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const input = testInfo.project.use.hasTouch ? "tap" : "click";
  await page.goto("/installation");
  await selectOrganization(page, fixture.organizationId);
  await page
    .getByLabel(copy.workspace.installation.machineName)
    .fill("Browser installation check");
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/me/keys") &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", {
      name: copy.workspace.installation.createKey,
      exact: true,
    })
    [input]();
  const keyResponse = await created;
  expect(keyResponse.ok()).toBe(true);
  const key = z.object({ key: z.string() }).parse(await keyResponse.json()).key;
  await page
    .getByRole("button", {
      name: copy.workspace.installation.copyCommand,
      exact: true,
    })
    [input]();
  const command = await page.evaluate(() => navigator.clipboard.readText());
  expect(command).toContain("http://localhost:3000/install.sh");
  expect(command).toContain(key);
  const metadata = await context.request.get("/api/v1/me/keys");
  expect(metadata.ok()).toBe(true);
  const listed = z
    .object({
      items: z.array(
        z.object({
          name: z.string().nullable(),
          permissions: z.record(z.string(), z.array(z.string())),
        }),
      ),
    })
    .parse(await metadata.json());
  expect(
    listed.items.find((item) => item.name === "Browser installation check")
      ?.permissions,
  ).toEqual({ sessions: ["ingest", "read"] });
  const captureFixture = z
    .object({ liveEnvelope: ingestEnvelopeSchema })
    .parse(
      JSON.parse(
        await readFile(
          "/tmp/agentcommons-dashboard-browser-state.json",
          "utf8",
        ),
      ),
    );
  const envelope = ingestEnvelopeSchema.parse({
    ...captureFixture.liveEnvelope,
    batchId: randomUUID(),
    harnessSessionId: randomUUID(),
    sentAt: new Date().toISOString(),
  });
  const accepted = await context.request.post("/api/v1/ingest", {
    headers: {
      authorization: `Bearer ${key}`,
      origin: "http://localhost:3000",
    },
    data: envelope,
  });
  expect(accepted.status()).toBe(202);
  const session = z
    .object({ sessionId: z.string() })
    .parse(await accepted.json());
  await expect(
    page.locator(`.installation-arrivals a[href="/s/${session.sessionId}"]`),
  ).toBeVisible({ timeout: 15000 });
  await expect(
    page.getByText(copy.workspace.installation.recent, { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
});
