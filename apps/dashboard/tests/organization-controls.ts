import { expect, type Page } from "@playwright/test";
import { z } from "zod";
import { copy } from "../src/copy";
import { activate } from "./browser-test";

export const switcher = (page: Page) =>
  page.getByRole("button", {
    name: copy.app.navigation.switchOrganization,
    exact: true,
  });
export async function openSwitcher(page: Page, isMobile: boolean) {
  await activate(switcher(page), isMobile);
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  return menu;
}
/** Picks an organization from the header switcher; `__create` opens the new-organization page. */
export async function selectOrganization(
  page: Page,
  id: string,
  isMobile: boolean,
) {
  // The switcher ignores the current organization, so only switch when needed.
  if (id !== "__create" && (await activeOrganizationId(page)) === id) {
    await expect(switcher(page)).toBeEnabled();
    return;
  }
  const menu = await openSwitcher(page, isMobile);
  if (id === "__create") {
    await activate(
      menu.getByRole("menuitem", {
        name: copy.app.navigation.newOrganization,
        exact: true,
      }),
      isMobile,
    );
    return;
  }
  const switched = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/v1/me/organization" &&
      response.request().method() === "POST",
  );
  await activate(
    menu.locator(`[role="menuitem"][data-organization-id="${id}"]`),
    isMobile,
  );
  expect((await switched).ok()).toBe(true);
  await expect.poll(() => activeOrganizationId(page)).toBe(id);
  await expect(switcher(page)).toBeEnabled();
}
async function activeOrganizationId(page: Page) {
  return z
    .object({ organization: z.object({ id: z.string() }).nullable() })
    .parse(await (await page.request.get("/api/v1/me")).json()).organization
    ?.id;
}
