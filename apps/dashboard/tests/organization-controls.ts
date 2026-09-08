import { expect, type Page } from "@playwright/test";
import { copy } from "../src/copy";

export async function selectOrganization(page: Page, id: string) {
  const trigger = page.getByRole("combobox", {
    name: copy.workspace.navigation.organization,
    exact: true,
  });
  const input = (await page.evaluate(() => navigator.maxTouchPoints > 0))
    ? "tap"
    : "click";
  await trigger[input]();
  if (id === "__create") {
    await page
      .getByRole("option", {
        name: copy.signup.organizationSubmit,
        exact: true,
      })
      [input]();
    return;
  }
  await page.locator(`[role="option"][data-organization-id="${id}"]`)[input]();
  await expect(trigger).toHaveAttribute("data-organization-id", id);
  await expect(trigger).toBeEnabled();
}
