import {
  accessible,
  activate,
  cookieSchema,
  setTheme,
  test,
} from "./browser-test";
import { selectOrganization, switcher } from "./organization-controls";
import { expect, type APIRequestContext } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { copy } from "../src/copy";
import { paths } from "../src/lib/routes";
import { saasStatePath } from "../playwright.shared";
const fixtureSchema = z.object({
  organizationId: z.string(),
  ownerCookies: z.array(cookieSchema),
});
const keyIds = async (request: APIRequestContext) => {
  const response = await request.get("/api/v1/me/keys");
  expect(response.ok()).toBe(true);
  return z
    .object({ items: z.array(z.object({ id: z.string() })) })
    .parse(await response.json())
    .items.map((item) => item.id)
    .sort();
};
const activeOrganization = async (request: APIRequestContext) =>
  z
    .object({
      organization: z.object({ id: z.string(), name: z.string() }).nullable(),
    })
    .parse(await (await request.get("/api/v1/me")).json()).organization;

// @req R-SAAS-01 @req R-SAAS-09 @req R-WEB-02 @req R-DASH-27
for (const theme of ["dark", "light"] as const)
  test(`name-only organization creation leads to an isolated install page in ${theme}`, async ({
    page,
    context,
    isMobile,
  }) => {
    const fixture = fixtureSchema.parse(
      JSON.parse(await readFile(saasStatePath, "utf8")),
    );
    await context.addCookies(fixture.ownerCookies);
    await setTheme(page, theme);
    await page.goto(paths.home);
    await selectOrganization(page, fixture.organizationId, isMobile);
    await expect(page.getByTestId("dashboard-picker")).toBeVisible();
    const beforeKeys = await keyIds(context.request);
    await selectOrganization(page, "__create", isMobile);
    await expect(page).toHaveURL(new RegExp(`${paths.organizationsNew}$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      copy.app.navigation.newOrganization,
    );
    const nameInput = page.getByTestId("onboarding-organization-name");
    await expect(nameInput).toBeVisible();
    await expect(
      page.getByLabel(copy.site.signup.slug, { exact: true }),
    ).toHaveCount(0);
    await accessible(page);
    await expect(page).toHaveScreenshot(`saas-new-organization-${theme}.png`, {
      fullPage: true,
    });
    const name = `Browser team ${randomUUID().slice(0, 8)}`;
    await nameInput.fill(name);
    const created = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/v1/me/organizations") &&
        response.request().method() === "POST",
    );
    await activate(page.getByTestId("onboarding-submit"), isMobile);
    expect((await created).status()).toBe(200);
    await expect(page).toHaveURL(new RegExp(`${paths.install}$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      copy.install.title,
    );
    await expect(page.getByTestId("install-command")).toBeVisible();
    await expect(switcher(page)).toHaveText(name);
    const current = await activeOrganization(context.request);
    if (!current)
      throw new Error("Expected the new organization to be active.");
    expect(current.id).not.toBe(fixture.organizationId);
    expect(current.name).toBe(name);
    expect(await keyIds(context.request)).toEqual([]);
    await page.goto(paths.billing);
    await expect(page.getByTestId("billing-plan")).toContainText(
      copy.site.saas.free,
    );
    await accessible(page);
    await selectOrganization(page, fixture.organizationId, isMobile);
    expect(await keyIds(context.request)).toEqual(beforeKeys);
    await selectOrganization(page, current.id, isMobile);
    await expect(switcher(page)).toHaveText(name);
    await page.goto(paths.home);
    await expect(page.getByTestId("dashboard-picker")).toHaveText(
      /Team overview/,
    );
    await expect(
      page.getByText(copy.dashboards.status.noSessions, { exact: true }),
    ).toBeVisible();
  });
