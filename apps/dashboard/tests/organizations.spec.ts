import { test } from "./browser-test";
import { selectOrganization } from "./organization-controls";
import { expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { copy } from "../src/copy";
const fixtureSchema = z.object({
  organizationId: z.string(),
  ownerCookies: z.array(
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
});
// @req R-SAAS-01 @req R-WEB-02
for (const theme of ["dark", "light"] as const)
  test(`organization creation leads to isolated installation in ${theme}`, async ({
    page,
    context,
  }, testInfo) => {
    const fixture = fixtureSchema.parse(
      JSON.parse(
        await readFile("/tmp/agentcommons-saas-browser-state.json", "utf8"),
      ),
    );
    await context.addCookies(fixture.ownerCookies);
    await page.addInitScript((value) => {
      localStorage.setItem("agentcommons-theme", value);
    }, theme);
    const input = testInfo.project.use.hasTouch ? "tap" : "click";
    await page.goto("/home");
    const picker = page.getByLabel(copy.workspace.navigation.organization, {
      exact: true,
    });
    await selectOrganization(page, fixture.organizationId);
    await expect(picker).toHaveAttribute(
      "data-organization-id",
      fixture.organizationId,
    );
    const before = await context.request.get("/api/v1/me/keys");
    expect(before.ok()).toBe(true);
    const beforeKeys = z
      .object({ items: z.array(z.object({ id: z.string() })) })
      .parse(await before.json());
    await selectOrganization(page, "__create");
    await expect(page).toHaveURL(/\/organizations\/new$/);
    await expect(
      page.getByLabel(copy.signup.organizationName, { exact: true }),
    ).toBeVisible();
    await expect(page).toHaveScreenshot(`saas-new-organization-${theme}.png`);
    const name = `Browser team ${randomUUID().slice(0, 8)}`;
    await page
      .getByLabel(copy.signup.organizationName, { exact: true })
      .fill(name);
    await page
      .getByLabel(copy.signup.slug, { exact: true })
      .fill(name.toLowerCase().replaceAll(" ", "-"));
    const created = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/v1/me/organizations") &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", {
        name: copy.signup.organizationSubmit,
        exact: true,
      })
      [input]();
    expect((await created).status()).toBe(200);
    await expect(page).toHaveURL(/\/installation$/);
    await expect(picker).toHaveText(name);
    const newId = z
      .string()
      .min(1)
      .parse(await picker.getAttribute("data-organization-id"));
    expect(newId).not.toBe(fixture.organizationId);
    const keys = await context.request.get("/api/v1/me/keys");
    expect(
      z.object({ items: z.array(z.unknown()) }).parse(await keys.json()).items,
    ).toEqual([]);
    await page.goto("/usage");
    await expect(
      page.getByText(copy.saas.free, { exact: true }).first(),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(testInfo.project.use.viewport?.width ?? 1440);
    expect(
      (await new AxeBuilder({ page }).analyze()).violations.filter((item) =>
        ["serious", "critical"].includes(item.impact ?? ""),
      ),
    ).toEqual([]);
    await selectOrganization(page, fixture.organizationId);
    await expect(picker).toHaveAttribute(
      "data-organization-id",
      fixture.organizationId,
    );
    const restored = await context.request.get("/api/v1/me/keys");
    expect(
      z
        .object({ items: z.array(z.object({ id: z.string() })) })
        .parse(await restored.json())
        .items.map((item) => item.id)
        .sort(),
    ).toEqual(beforeKeys.items.map((item) => item.id).sort());
    await selectOrganization(page, newId);
    await expect(picker).toHaveAttribute("data-organization-id", newId);
    await page.goto("/installation");
    await expect(
      page.getByRole("heading", {
        name: copy.workspace.installation.title,
        exact: true,
      }),
    ).toBeVisible();
  });
