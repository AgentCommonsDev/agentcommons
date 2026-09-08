import { test } from "./browser-test";
import { expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { copy } from "../src/copy";
const fixtureSchema = z.object({
  ingestKey: z.string(),
  embeddings: z.object({
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
          sameSite: z.enum(["Lax", "Strict", "None"]),
        }),
      ),
    }),
  }),
});
// @req R-EMB-06 @req R-WEB-02
for (const theme of ["light", "dark"] as const)
  test(`organization embeddings ${theme} confirms audited changes, shows truthful fake-provider progress, and keeps the other organization enabled`, async ({
    page,
    context,
    request,
  }, testInfo) => {
    const fixture = fixtureSchema.parse(
      JSON.parse(
        await readFile(
          "/tmp/agentcommons-dashboard-browser-state.json",
          "utf8",
        ),
      ),
    );
    await context.addCookies(fixture.embeddings.storageState.cookies);
    const activation = testInfo.project.use.hasTouch ? "tap" : "click";
    const path = "/api/v1/organization/embeddings";
    const reset = await context.request.patch(path, {
      headers: { Origin: "http://localhost:3000" },
      data: {
        enabled: false,
        reason: "Reset isolated browser embedding organization",
      },
    });
    expect(reset.status()).toBe(200);
    await page.goto("/admin/status");
    const themeButton = page.getByRole("button", {
      name: theme === "light" ? copy.theme.light : copy.theme.dark,
      exact: true,
    });
    if (await themeButton.count()) await themeButton[activation]();
    const text = copy.workspace.organizationEmbeddings;
    const section = page.getByRole("region", { name: text.title, exact: true });
    await expect(
      section.getByText(text.disabled, { exact: true }),
    ).toBeVisible();
    await expect(section.getByText(text.fake, { exact: true })).toBeVisible();
    await section
      .getByRole("button", { name: text.enable, exact: true })
      [activation]();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText(text.enableDescription);
    const submit = dialog.getByRole("button", {
      name: text.enable,
      exact: true,
    });
    await expect(submit).toBeDisabled();
    await dialog
      .getByLabel(copy.workspace.common.reason, { exact: true })
      .fill("Enable the isolated browser organization's corpus");
    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith(path) &&
        response.request().method() === "PATCH",
    );
    await submit[activation]();
    expect((await saved).status()).toBe(200);
    await expect(dialog).toHaveCount(0);
    await expect(
      section.getByText(text.enabled, { exact: true }),
    ).toBeVisible();
    await expect
      .poll(
        async () => {
          const response = await context.request.get(path);
          return z
            .object({ sessions_indexed: z.number() })
            .parse(await response.json()).sessions_indexed;
        },
        { timeout: 30_000 },
      )
      .toBe(1);
    await page.reload();
    await expect(
      section
        .locator("dt")
        .filter({ hasText: text.indexed })
        .locator("..")
        .locator("dd"),
    ).toHaveText("1");
    expect(
      (
        await new AxeBuilder({ page })
          .include('[aria-labelledby="organization-embeddings-title"]')
          .analyze()
      ).violations,
    ).toEqual([]);
    await section
      .getByRole("button", { name: text.disable, exact: true })
      [activation]();
    await expect(dialog).toContainText(text.disableDescription);
    await dialog
      .getByLabel(copy.workspace.common.reason, { exact: true })
      .fill("Stop the isolated organization's provider requests");
    const disabled = page.waitForResponse(
      (response) =>
        response.url().endsWith(path) &&
        response.request().method() === "PATCH",
    );
    await dialog
      .getByRole("button", { name: text.disable, exact: true })
      [activation]();
    expect((await disabled).status()).toBe(200);
    await expect(
      section.getByText(text.disabled, { exact: true }),
    ).toBeVisible();
    const other = await request.get(path, {
      headers: { authorization: `Bearer ${fixture.ingestKey}` },
    });
    expect(other.status()).toBe(200);
    expect(
      z.object({ effective: z.boolean() }).parse(await other.json()).effective,
    ).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });

// @req R-EMB-06
test("global operator unavailability explains why an organization cannot enable embeddings", async ({
  page,
  context,
}) => {
  const fixture = fixtureSchema.parse(
    JSON.parse(
      await readFile("/tmp/agentcommons-dashboard-browser-state.json", "utf8"),
    ),
  );
  await context.addCookies(fixture.embeddings.storageState.cookies);
  await page.goto("http://localhost:3001/admin/status");
  const text = copy.workspace.organizationEmbeddings;
  const section = page.getByRole("region", { name: text.title, exact: true });
  await expect(
    section.getByText(text.unavailable, { exact: true }),
  ).toBeVisible();
  await expect(
    section.getByRole("button", { name: text.enable, exact: true }),
  ).toBeDisabled();
  await expect(section.getByText(text.fake, { exact: true })).toHaveCount(0);
});
