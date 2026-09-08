import { test } from "./browser-test";
import { expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { copy } from "../src/copy";

const fixtureSchema = z.object({
  ownerCookies: z.array(
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
});
// @req R-ORG-11 @req R-DASH-06 @req R-WEB-02
for (const theme of ["light", "dark"] as const)
  test(`Users ${theme} expands direct email access and keeps native DNS proof usable through failed verification`, async ({
    page,
    context,
  }, testInfo) => {
    const activation = testInfo.project.use.hasTouch ? "tap" : "click";
    const fixture = fixtureSchema.parse(
      JSON.parse(
        await readFile("/tmp/agentcommons-saas-browser-state.json", "utf8"),
      ),
    );
    await context.addCookies(fixture.ownerCookies);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/admin/users");
    const themeButton = page.getByRole("button", {
      name: theme === "light" ? copy.theme.light : copy.theme.dark,
      exact: true,
    });
    if (await themeButton.count()) await themeButton[activation]();
    const add = page.getByRole("button", {
      name: copy.workspace.users.add,
      exact: true,
    });
    await expect(add).toBeVisible();
    await add[activation]();
    await expect(add).toHaveAttribute("aria-expanded", "true");
    const form = page.locator("#add-people-form");
    await expect(form).toBeVisible();
    const email = `browser-access-${randomUUID()}@example.test`;
    await form.getByLabel(copy.workspace.users.emails).fill(email);
    const added = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/v1/admin/users") &&
        response.request().method() === "POST",
    );
    await form
      .getByRole("button", { name: copy.workspace.users.addSubmit })
      [activation]();
    expect((await added).status()).toBe(200);
    await expect(
      form.getByRole("status").filter({ hasText: email }),
    ).toContainText(email);
    await expect(
      form.getByRole("status").filter({ hasText: email }),
    ).toContainText(copy.workspace.users.added);
    await form
      .getByRole("button", { name: copy.workspace.common.close, exact: true })
      [activation]();
    await expect(form).toHaveCount(0);
    await add[activation]();
    await expect(form.getByLabel(copy.workspace.users.emails)).toHaveValue("");
    await form
      .getByRole("button", { name: copy.workspace.common.close, exact: true })
      [activation]();
    await page
      .getByRole("button", { name: copy.workspace.domains.title, exact: true })
      [activation]();
    const section = page.getByRole("region", {
      name: copy.workspace.domains.title,
      exact: true,
    });
    const registration = section.locator("form").filter({
      has: page.getByRole("button", {
        name: copy.workspace.domains.register,
        exact: true,
      }),
    });
    const domain = `browser-${randomUUID()}.example.test`;
    await registration
      .getByLabel(copy.workspace.domains.domain, { exact: true })
      .fill(domain);
    await registration
      .getByRole("button", {
        name: copy.workspace.domains.register,
        exact: true,
      })
      [activation]();
    const proof = section.getByRole("region", {
      name: copy.workspace.domains.proof,
      exact: true,
    });
    await expect(proof).toBeVisible();
    const name = await proof
      .getByLabel(copy.workspace.domains.recordName)
      .inputValue();
    const value = await proof
      .getByLabel(copy.workspace.domains.recordValue)
      .inputValue();
    expect(name).toMatch(/^_better-auth-token-domain-/);
    expect(name.endsWith(`.${domain}`)).toBe(true);
    expect(value.length).toBeGreaterThan(10);
    await proof
      .getByRole("button", {
        name: copy.workspace.domains.copyName,
        exact: true,
      })
      [activation]();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe(name);
    await proof
      .getByRole("button", {
        name: copy.workspace.domains.copyValue,
        exact: true,
      })
      [activation]();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe(value);
    for (let attempt = 0; attempt < 2; attempt++) {
      const verification = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/v1/admin/domains/verify") &&
          response.request().method() === "POST",
      );
      await proof
        .getByRole("button", {
          name: copy.workspace.domains.verify,
          exact: true,
        })
        [activation]();
      expect((await verification).status()).toBeGreaterThanOrEqual(400);
      await expect(
        proof.getByLabel(copy.workspace.domains.recordName),
      ).toHaveValue(name);
      await expect(
        proof.getByLabel(copy.workspace.domains.recordValue),
      ).toHaveValue(value);
      await expect(
        proof.getByRole("button", {
          name: copy.workspace.domains.verify,
          exact: true,
        }),
      ).toBeEnabled();
    }
    await add[activation]();
    await expect(form).toBeVisible();
    await expect(section).toHaveCount(0);
    await page
      .getByRole("button", { name: copy.workspace.domains.title, exact: true })
      [activation]();
    await expect(form).toHaveCount(0);
    const filters = section.locator("form").filter({
      has: page.getByRole("button", {
        name: copy.workspace.domains.filter,
        exact: true,
      }),
    });
    await filters
      .getByLabel(copy.workspace.domains.domain, { exact: true })
      .fill(domain);
    await filters
      .getByRole("button", { name: copy.workspace.domains.filter, exact: true })
      [activation]();
    const recover = section.getByRole("button", {
      name: copy.workspace.domains.showProof,
      exact: true,
    });
    await expect(recover).toHaveCount(1);
    await recover[activation]();
    await expect(
      proof.getByLabel(copy.workspace.domains.recordName),
    ).toHaveValue(name);
    await expect(
      proof.getByLabel(copy.workspace.domains.recordValue),
    ).toHaveValue(value);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    expect(
      (await new AxeBuilder({ page }).analyze()).violations.filter(
        (row) => row.impact === "critical" || row.impact === "serious",
      ),
    ).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath("users-domain-access.png"),
      fullPage: true,
    });
  });
