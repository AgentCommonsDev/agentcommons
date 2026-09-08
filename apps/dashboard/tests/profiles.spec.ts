import { test } from "./browser-test";
import { selectOrganization } from "./organization-controls";
import { expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import { z } from "zod";
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
// @req R-DASH-25 @req R-WEB-02
for (const theme of ["dark", "light"] as const)
  test(`personal dashboards create, edit, duplicate, restore and delete in ${theme}`, async ({
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
    await page.addInitScript((value) => {
      localStorage.setItem("agentcommons-theme", value);
    }, theme);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    const input = testInfo.project.use.hasTouch ? "tap" : "click";
    const labels = copy.workspace.profiles;
    const name = `Dashboard ${testInfo.project.name} ${theme}`;
    await page.goto("/home");
    await selectOrganization(page, fixture.organizationId);
    await page
      .getByRole("button", { name: labels.create, exact: true })
      [input]();
    const editor = page.getByRole("region", {
      name: labels.editor,
      exact: true,
    });
    await expect(editor).toBeVisible();
    await editor.getByLabel(labels.name, { exact: true }).fill(name);
    await editor
      .locator(".profile-jsonforms")
      .getByLabel(/^Title/)
      .fill("Captured history");
    await editor
      .getByRole("button", { name: "Add to Widgets", exact: true })
      [input]();
    const titles = editor.locator(".profile-jsonforms").getByLabel(/^Title/);
    await expect(titles).toHaveCount(2);
    await editor
      .getByRole("button", { name: "Move item down", exact: true })
      .first()
      [input]();
    await expect(titles.last()).toHaveValue("Captured history");
    await editor
      .getByRole("button", { name: "Move item up", exact: true })
      .last()
      [input]();
    await expect(titles.first()).toHaveValue("Captured history");
    page.once("dialog", (dialog) => {
      void dialog.accept();
    });
    await editor
      .getByRole("button", { name: "Delete button", exact: true })
      .last()
      [input]();
    await expect(titles).toHaveCount(1);
    await expect(
      editor.getByRole("button", { name: "Add to Widgets", exact: true }),
    ).toBeFocused();
    await page.evaluate(() => {
      window.scrollTo(0, 0);
    });
    await page.screenshot({
      path: testInfo.outputPath(`profile-form-${theme}.png`),
      fullPage: true,
    });
    await editor
      .getByRole("button", { name: labels.save, exact: true })
      [input]();
    const widget = page.getByRole("region", {
      name: "Captured history",
      exact: true,
    });
    await expect(widget.locator(".dashboard-number strong")).toHaveText(/\d+/);
    await page.screenshot({
      path: testInfo.outputPath(`profile-number-${theme}.png`),
      fullPage: true,
    });
    const originalId = await page
      .getByLabel(labels.selector, { exact: true })
      .inputValue();
    await page.reload();
    await page
      .getByLabel(labels.selector, { exact: true })
      .selectOption(originalId);
    await expect(
      page.getByRole("region", { name: "Captured history", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: labels.duplicate, exact: true })
      [input]();
    await editor.getByLabel(labels.name, { exact: true }).fill(`${name} chart`);
    await editor
      .getByRole("combobox", { name: labels.editor, exact: true })
      .selectOption("json");
    const definition = {
      version: 1,
      widgets: [
        {
          id: "chart",
          title: "Query chart",
          sql: "SELECT 'First' AS label, 1 AS value UNION ALL SELECT 'Second' AS label, 2 AS value",
          display: "bar",
          x: "label",
          y: "value",
          unit: "count",
        },
      ],
    };
    await editor
      .getByLabel(labels.definition, { exact: true })
      .fill(JSON.stringify(definition));
    await editor
      .getByRole("button", { name: labels.save, exact: true })
      [input]();
    const chart = page.getByRole("region", {
      name: "Query chart",
      exact: true,
    });
    await expect(chart.locator(".recharts-bar-rectangle")).toHaveCount(2);
    await page.screenshot({
      path: testInfo.outputPath(`profile-bar-${theme}.png`),
      fullPage: true,
    });
    const duplicateId = await page
      .getByLabel(labels.selector, { exact: true })
      .inputValue();
    expect(duplicateId).not.toBe(originalId);
    await page.getByRole("button", { name: labels.edit, exact: true })[input]();
    await editor
      .getByRole("combobox", { name: labels.editor, exact: true })
      .selectOption("json");
    await editor.getByLabel(labels.definition, { exact: true }).fill(
      JSON.stringify({
        ...definition,
        widgets: [{ ...definition.widgets[0], display: "line" }],
      }),
    );
    await editor
      .getByRole("button", { name: labels.save, exact: true })
      [input]();
    await expect(chart.locator(".recharts-line-curve")).toHaveCount(1);
    await page.screenshot({
      path: testInfo.outputPath(`profile-line-${theme}.png`),
      fullPage: true,
    });
    await chart.getByText(labels.data, { exact: true })[input]();
    const download = page.waitForEvent("download");
    await chart
      .getByRole("button", { name: copy.workspace.common.export, exact: true })
      [input]();
    const path = await (await download).path();
    if (!path) throw new Error("Missing widget CSV download");
    expect(await readFile(path, "utf8")).toContain("First");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(testInfo.project.use.viewport?.width ?? 1440);
    expect(
      (await new AxeBuilder({ page }).analyze()).violations.filter((item) =>
        ["serious", "critical"].includes(item.impact ?? ""),
      ),
    ).toEqual([]);
    for (const id of [duplicateId, originalId]) {
      await page.getByLabel(labels.selector, { exact: true }).selectOption(id);
      await page
        .getByRole("button", { name: labels.remove, exact: true })
        [input]();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: labels.remove, exact: true })
        [input]();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(
        page
          .getByLabel(labels.selector, { exact: true })
          .locator(`option[value="${id}"]`),
      ).toHaveCount(0);
    }
    expect(errors).toEqual([]);
  });
