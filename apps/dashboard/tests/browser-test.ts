import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  expect,
  test as base,
  type APIRequestContext,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { z } from "zod";
import { ingestEnvelopeSchema } from "@agentcommons/core/schemas";
import { copy } from "../src/copy";
import { workspaceOrigin, workspaceStatePath } from "../playwright.shared";

// Independent browser tests represent distinct clients behind the fixture's
// trusted loopback proxy. Keep the real per-client authentication rate limit.
export const test = base.extend({
  context: async ({ context }, use) => {
    const identity = randomBytes(12);
    const suffix = Array.from({ length: 6 }, (_, index) =>
      identity.readUInt16BE(index * 2).toString(16),
    ).join(":");
    await context.setExtraHTTPHeaders({
      "x-forwarded-for": `2001:db8:${suffix}`,
    });
    await use(context);
  },
});

export const cookieSchema = z.object({
  name: z.string(),
  value: z.string(),
  domain: z.string(),
  path: z.string(),
  httpOnly: z.boolean(),
  secure: z.boolean(),
  sameSite: z.enum(["Lax", "Strict", "None"]),
});
const storageStateSchema = z.object({
  cookies: z.array(cookieSchema),
  origins: z.array(
    z.object({
      origin: z.string(),
      localStorage: z.array(z.object({ name: z.string(), value: z.string() })),
    }),
  ),
});
/** What `scripts/browser-server.mjs` writes once its disposable API is seeded. */
const workspaceStateSchema = z.object({
  storageState: storageStateSchema,
  ingestKey: z.string(),
  liveEnvelope: ingestEnvelopeSchema,
  sessionId: z.uuid(),
  childSessionId: z.uuid(),
  /** A root whose Agent result names its child, so the transcript nests that run. */
  treeSessionId: z.uuid(),
  treeChildSessionId: z.uuid(),
  foreignSessionId: z.uuid(),
  organizationId: z.string(),
  secondaryOrganizationId: z.string(),
  ownerEmail: z.email(),
  setupUrl: z.url(),
  visual: z.object({
    timeShiftMs: z.number().int(),
    storageState: storageStateSchema,
    sessionId: z.uuid(),
    setupUrl: z.url(),
  }),
  reuse: z.object({
    sourceSessionId: z.uuid(),
    targetSessionId: z.uuid(),
    userEmail: z.email(),
    readerUserId: z.string().min(1),
    storageState: storageStateSchema,
  }),
});
type WorkspaceState = z.infer<typeof workspaceStateSchema>;
export async function fixture(): Promise<WorkspaceState> {
  return workspaceStateSchema.parse(
    JSON.parse(await readFile(workspaceStatePath, "utf8")),
  );
}
/** Cookie writes must carry the configured site origin (CSRF check in the API). */
async function selectOrganizationThroughApi(
  request: APIRequestContext,
  organizationId: string,
) {
  const response = await request.post("/api/v1/me/organization", {
    headers: { origin: workspaceOrigin },
    data: { organization_id: organizationId },
  });
  expect(response.ok(), await response.text()).toBe(true);
}
/** The primary organization's owner with that organization active. */
export async function signInAsOwner(context: BrowserContext) {
  const state = await fixture();
  await context.clearCookies();
  await context.addCookies(state.storageState.cookies);
  await selectOrganizationThroughApi(context.request, state.organizationId);
  return state;
}
/** A member of exactly one organization (the primary one). */
export async function signInAsMember(context: BrowserContext) {
  const state = await fixture();
  await context.clearCookies();
  await context.addCookies(state.reuse.storageState.cookies);
  return state;
}
/** Touch projects tap; the desktop project clicks. */
export async function activate(locator: Locator, isMobile: boolean) {
  if (isMobile) await locator.tap();
  else await locator.click();
}
/** Fails the test on any page error, console error, failed request or 4xx/5xx response. */
export function collectErrors(page: Page) {
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
  return errors;
}
/** Waits for loading states to settle so assertions read final content. */
export async function settled(page: Page) {
  await expect(
    page.getByText(copy.app.common.loading, { exact: true }),
  ).toHaveCount(0);
  await expect(page.locator("table[aria-busy='true']")).toHaveCount(0);
}
export async function accessible(page: Page) {
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
export async function setTheme(page: Page, theme: "dark" | "light") {
  await page.addInitScript((value) => {
    localStorage.setItem("agentcommons-theme", value);
  }, theme);
}
/** The theme toggle is labelled with the theme it switches to. */
export function themeToggle(page: Page, current: "dark" | "light") {
  return page.getByRole("button", {
    name:
      current === "dark"
        ? copy.app.common.theme.light
        : copy.app.common.theme.dark,
    exact: true,
  });
}
/** The number a stat tile shows once its query returned. */
export function statValue(tile: Locator) {
  return tile.locator("p.tabular-nums").first();
}
export async function statNumber(tile: Locator): Promise<number> {
  await expect(statValue(tile)).toHaveText(/^[\d.,]+%?$/, { timeout: 20_000 });
  return Number((await statValue(tile).innerText()).replaceAll(/[,%]/g, ""));
}
/** A table row (works for the stacked mobile layout, which keeps `tr` elements). */
export function tableRow(scope: Locator | Page, text: string | RegExp) {
  return scope.locator("tbody tr").filter({ hasText: text });
}
/** The confirmation dialog: reason field, then the button carrying the action label. */
export async function confirm(
  page: Page,
  label: string,
  reason: string | null,
) {
  const dialog = page.getByRole("dialog");
  const button = dialog.getByRole("button", { name: label, exact: true });
  if (reason !== null) {
    await expect(button).toBeDisabled();
    await dialog
      .getByLabel(copy.app.common.reason, { exact: true })
      .fill(reason);
  }
  await button.click();
  await expect(dialog).toHaveCount(0);
}
/** Opens the row overflow menu and picks one item. */
export async function rowAction(row: Locator, label: string) {
  await row
    .getByRole("button", { name: copy.app.common.actions, exact: true })
    .click();
  const item = row
    .page()
    .getByRole("menu")
    .getByRole("menuitem", { name: label, exact: true });
  await expect(item).toBeVisible();
  return item;
}
/**
 * Table filters render inline from 640px and inside a bottom sheet below it. `fill`
 * receives the scope holding the controls; Apply submits in both layouts.
 */
export async function applyFilters(
  page: Page,
  label: string,
  fill: (scope: Locator) => Promise<void>,
) {
  const wide = (page.viewportSize()?.width ?? 1440) >= 640;
  if (wide) {
    const form = page.getByRole("search", { name: label, exact: true });
    await fill(form);
    await form
      .getByRole("button", { name: copy.app.common.apply, exact: true })
      .click();
    return;
  }
  await page.getByRole("button", { name: label, exact: true }).click();
  const sheet = page.getByRole("dialog");
  await fill(sheet);
  await sheet
    .getByRole("button", { name: copy.app.common.apply, exact: true })
    .click();
  await expect(sheet).toHaveCount(0);
}
/** Dialogs carry an icon close button and sometimes a footer Close; the icon is last. */
export async function closeDialog(page: Page) {
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: copy.app.common.close, exact: true })
    .last()
    .click();
  await expect(dialog).toHaveCount(0);
}
