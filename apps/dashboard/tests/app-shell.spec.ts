import { expect, type Page } from "@playwright/test";
import { z } from "zod";
import { builtinDashboardId } from "@agentcommons/core/schemas/dashboards";
import { organizationsOutputSchema } from "@agentcommons/core/schemas";
import { copy } from "../src/copy";
import { paths } from "../src/lib/routes";
import { workspaceOrigin } from "../playwright.shared";
import { testAccountPassword } from "../../api/test/support";
import {
  accessible,
  accountLocation,
  activate,
  openNavigation,
  collectErrors,
  fixture,
  setTheme,
  settled,
  signInAsMember,
  signInAsOwner,
  statNumber,
  test,
  themeToggle,
} from "./browser-test";
import {
  openSwitcher,
  selectOrganization,
  switcher,
} from "./organization-controls";

const navigation = copy.app.navigation;
async function organizations(page: Page) {
  return organizationsOutputSchema.parse(
    await (await page.request.get("/api/v1/me/organizations")).json(),
  ).organizations;
}

// @req R-DASH-27 @req R-ORG-10 @req R-DASH-34
test("anonymous application visits go to sign-in and legacy paths are neither served nor redirected", async ({
  page,
  context,
}) => {
  // Home needs no return address; any other page travels along as `next`.
  for (const [path, next] of [
    [paths.home, null],
    [paths.admin.users, paths.admin.users],
  ] as const) {
    await page.goto(path);
    await expect
      .poll(() => accountLocation(page))
      .toEqual({ path: paths.login, next });
    await expect(page.getByTestId("auth-card")).toBeVisible();
  }
  const state = await signInAsOwner(context);
  for (const legacy of [
    "/home",
    "/sessions",
    "/installation",
    "/usage",
    `/s/${state.sessionId}`,
  ]) {
    await page.goto(legacy);
    await expect(page).toHaveURL(new RegExp(`${legacy}$`));
    await expect(
      page.getByText(copy.site.notFound.title, { exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("dashboard-picker")).toHaveCount(0);
  }
});

// @req R-DASH-01 @req R-DASH-09 @req R-ORG-10 @req R-WEB-02
test("the shell shows the workspace and organization groups to an admin and hides the organization group from a member", async ({
  page,
  context,
  isMobile,
}) => {
  await signInAsOwner(context);
  await page.goto(paths.home);
  await expect(page.getByTestId("dashboard-picker")).toBeVisible();
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const nav = await openNavigation(page, isMobile);
  await expect(
    nav.getByText(navigation.workspace, { exact: true }),
  ).toBeVisible();
  await expect(
    nav.getByText(navigation.organization, { exact: true }),
  ).toBeVisible();
  for (const label of [
    navigation.home,
    navigation.sessions,
    navigation.sql,
    navigation.install,
    navigation.keys,
    navigation.users,
    navigation.adminKeys,
    navigation.managementMcp,
    navigation.audit,
    navigation.moderation,
    navigation.redaction,
    navigation.status,
    navigation.settings,
    navigation.api,
  ])
    await expect(
      nav.getByRole("link", { name: label, exact: true }),
    ).toBeVisible();
  // Workspace order reflects the setup flow: install first, then the keys it needs.
  await expect(nav.getByRole("link")).toContainText([
    navigation.home,
    navigation.sessions,
    navigation.sql,
    navigation.install,
    navigation.keys,
  ]);
  await expect(
    nav.getByRole("link", { name: navigation.api, exact: true }),
  ).toHaveAttribute("href", paths.api);
  await expect(
    nav.getByRole("link", { name: navigation.api, exact: true }),
  ).not.toHaveAttribute("target", "_blank");
  await expect(
    nav.getByRole("link", { name: navigation.billing, exact: true }),
  ).toHaveCount(0);
  await expect(
    nav.getByRole("link", { name: navigation.home, exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await activate(
    nav.getByRole("link", { name: navigation.users, exact: true }),
    isMobile,
  );
  await expect(page).toHaveURL(new RegExp(`${paths.admin.users}$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    copy.admin.users.title,
  );
  if (isMobile) await expect(page.getByRole("dialog")).toHaveCount(0);
  const again = await openNavigation(page, isMobile);
  await expect(
    again.getByRole("link", { name: navigation.users, exact: true }),
  ).toHaveAttribute("aria-current", "page");
  if (isMobile) {
    await activate(
      page.getByRole("button", { name: navigation.closeMenu, exact: true }),
      true,
    );
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }

  const state = await signInAsMember(context);
  await page.goto(paths.home);
  await expect(page.getByTestId("dashboard-picker")).toBeVisible();
  const memberNav = await openNavigation(page, isMobile);
  await expect(
    memberNav.getByRole("link", { name: navigation.home, exact: true }),
  ).toBeVisible();
  await expect(
    memberNav.getByText(navigation.organization, { exact: true }),
  ).toHaveCount(0);
  for (const label of [navigation.users, navigation.settings, navigation.audit])
    await expect(
      memberNav.getByRole("link", { name: label, exact: true }),
    ).toHaveCount(0);
  if (isMobile)
    await activate(
      page.getByRole("button", { name: navigation.closeMenu, exact: true }),
      true,
    );
  await activate(
    page.getByRole("button", { name: navigation.account, exact: true }),
    isMobile,
  );
  await expect(page.getByRole("menu")).toContainText(state.reuse.userEmail);
  await page.keyboard.press("Escape");
});

// @req R-ORG-10 @req R-ORG-08 @req R-DASH-16 @req R-WEB-02
test("the organization switcher lists both memberships and switching changes data without changing a key's organization", async ({
  page,
  context,
  isMobile,
  request,
}) => {
  const state = await signInAsOwner(context);
  await page.goto(paths.home);
  const list = await organizations(page);
  const primary = list.find((entry) => entry.id === state.organizationId);
  const secondary = list.find(
    (entry) => entry.id === state.secondaryOrganizationId,
  );
  if (!primary || !secondary) throw new Error("Expected both memberships.");
  expect(primary.role).toBe("owner");
  expect(secondary.role).toBe("member");
  await expect(switcher(page)).toHaveText(primary.name);
  const captured = page.getByTestId("dashboard-tile-captured_sessions");
  const before = await statNumber(captured);
  expect(before).toBeGreaterThan(1);
  const menu = await openSwitcher(page, isMobile);
  await expect(menu.getByRole("menuitem")).toHaveCount(2);
  for (const entry of [primary, secondary])
    await expect(
      menu.locator(`[role="menuitem"][data-organization-id="${entry.id}"]`),
    ).toHaveText(entry.name);
  await page.keyboard.press("Escape");
  await selectOrganization(page, secondary.id, isMobile);
  await expect(switcher(page)).toHaveText(secondary.name);
  expect(await statNumber(captured)).toBe(1);
  const nav = await openNavigation(page, isMobile);
  await expect(
    nav.getByText(navigation.organization, { exact: true }),
  ).toHaveCount(0);
  if (isMobile) {
    await activate(
      page.getByRole("button", { name: navigation.closeMenu, exact: true }),
      true,
    );
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  // The browser selection never moves a key: the primary ingest key still reads
  // its own organization and nothing else.
  const headers = { authorization: `Bearer ${state.ingestKey}` };
  expect(
    (
      await request.get(`/api/v1/sessions/${state.sessionId}`, { headers })
    ).status(),
  ).toBe(200);
  expect(
    (
      await request.get(`/api/v1/sessions/${state.foreignSessionId}`, {
        headers,
      })
    ).status(),
  ).toBe(404);
  await selectOrganization(page, primary.id, isMobile);
  await expect(switcher(page)).toHaveText(primary.name);
  // Background purge cleanup from other tests can move the count by one.
  expect(await statNumber(captured)).toBeGreaterThan(1);
  await accessible(page);
});

// @req R-ORG-10
test("a member of exactly one organization lands in it without a picker", async ({
  page,
  context,
}) => {
  const state = await signInAsMember(context);
  const errors = collectErrors(page);
  await page.goto(paths.home);
  await expect(page.getByTestId("dashboard-picker")).toBeVisible();
  await expect(
    page.getByText(navigation.chooseOrganization, { exact: true }),
  ).toHaveCount(0);
  const [membership] = await organizations(page);
  if (!membership) throw new Error("Expected one membership.");
  expect(membership.id).toBe(state.organizationId);
  // One membership and no way to create another: the name is a label, not a menu.
  await expect(page.getByTestId("organization-name")).toHaveText(
    membership.name,
  );
  await expect(switcher(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});

// @req R-DASH-01 @req R-ORG-10 @req R-WEB-02
test("a fresh sign-in lands in the first membership, the theme toggle persists, the skip link reaches the content and the account menu signs out", async ({
  page,
  context,
  isMobile,
}) => {
  // Sign in afresh: signing out must not destroy the fixture's shared session.
  const state = await fixture();
  const signedIn = await context.request.post("/auth/sign-in/email", {
    headers: { origin: workspaceOrigin },
    data: { email: state.ownerEmail, password: testAccountPassword },
  });
  expect(signedIn.ok(), await signedIn.text()).toBe(true);
  // A new session has no active organization; the app selects the first membership.
  const [first] = await organizations(page);
  if (!first) throw new Error("Expected a membership.");
  await page.goto(paths.home);
  await expect(page.getByTestId("dashboard-picker")).toBeVisible();
  await expect(switcher(page)).toHaveText(first.name);
  await expect(
    page.getByText(navigation.chooseOrganization, { exact: true }),
  ).toHaveCount(0);
  expect(
    z
      .object({ organization: z.object({ id: z.string() }).nullable() })
      .parse(await (await page.request.get("/api/v1/me")).json()).organization
      ?.id,
  ).toBe(first.id);
  // Nothing has been clicked yet, so the first Tab lands on the skip link.
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: copy.site.skip, exact: true });
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main$/);
  await expect(page.locator("main#main")).toBeVisible();

  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await activate(themeToggle(page, "dark"), isMobile);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(
    await page.evaluate(() => localStorage.getItem("agentcommons-theme")),
  ).toBe("light");
  await accessible(page);
  await activate(themeToggle(page, "light"), isMobile);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await activate(
    page.getByRole("button", { name: navigation.account, exact: true }),
    isMobile,
  );
  const menu = page.getByRole("menu");
  await expect(menu).toContainText(state.ownerEmail);
  await activate(
    menu.getByRole("menuitem", { name: navigation.signOut, exact: true }),
    isMobile,
  );
  await expect(page).toHaveURL(/\/login$/);
  expect((await context.request.get("/api/v1/me")).status()).toBe(401);
});

// @req R-DASH-24 @req R-WEB-02
test("a self-hosted instance sends the site root to the application: sign-in when anonymous, Home when signed in", async ({
  page,
  context,
}) => {
  await page.goto(paths.site);
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByTestId("auth-card")).toBeVisible();
  await expect(
    page.getByRole("link", { name: copy.site.saas.signup, exact: true }),
  ).toHaveCount(0);
  await signInAsOwner(context);
  await page.goto(paths.site);
  await expect(page).toHaveURL(new RegExp(`${paths.home}$`));
  await expect(page.getByTestId("dashboard-picker")).toBeVisible();
  await expect(
    page.getByRole("link", { name: copy.site.hero.primary, exact: true }),
  ).toHaveCount(0);
});

// @req R-DASH-01 @req R-DASH-07 @req R-WEB-02 @req R-DASH-27
for (const theme of ["dark", "light"] as const)
  test(`every finished screen is accessible without overflow, console or network errors in ${theme}`, async ({
    page,
    context,
  }, info) => {
    const state = await signInAsOwner(context);
    const errors = collectErrors(page);
    await setTheme(page, theme);
    const dashboard = page.getByTestId("dashboard-picker");
    const heading = page.getByRole("heading", { level: 1 });
    const screens: { path: string; ready: () => Promise<void> }[] = [
      {
        path: paths.home,
        ready: async () => {
          await expect(dashboard).toBeVisible();
          await statNumber(
            page.getByTestId("dashboard-tile-captured_sessions"),
          );
        },
      },
      {
        path: paths.dashboard(builtinDashboardId),
        ready: async () => {
          await expect(dashboard).toBeVisible();
          await statNumber(
            page.getByTestId("dashboard-tile-captured_sessions"),
          );
        },
      },
      {
        path: paths.dashboardNew,
        ready: () => expect(heading).toHaveText(copy.dashboards.newPage.title),
      },
      {
        path: paths.admin.users,
        ready: () => expect(heading).toHaveText(copy.admin.users.title),
      },
      {
        path: paths.admin.keys,
        ready: () => expect(heading).toHaveText(copy.admin.keys.title),
      },
      {
        path: paths.admin.mcp,
        ready: async () => {
          await expect(heading).toHaveText(copy.admin.mcp.title);
          await expect(page.getByTestId("management-key")).toBeVisible();
          await expect(
            page.getByTestId("management-keys-table").getByRole("table"),
          ).toBeVisible();
        },
      },
      {
        path: paths.admin.audit,
        ready: () => expect(heading).toHaveText(copy.admin.audit.title),
      },
      {
        path: paths.admin.moderation,
        ready: () => expect(heading).toHaveText(copy.admin.moderation.title),
      },
      {
        path: paths.admin.redaction,
        ready: () => expect(heading).toHaveText(copy.admin.redaction.title),
      },
      {
        path: paths.admin.status,
        ready: async () => {
          await expect(heading).toHaveText(copy.admin.status.title);
          await expect(page.getByTestId("admin-status-snapshot")).toBeVisible();
        },
      },
      {
        path: paths.admin.settings,
        ready: async () => {
          await expect(heading).toHaveText(copy.settings.title);
          await expect(
            page
              .getByTestId("settings-default-dashboard")
              .getByRole("combobox"),
          ).toBeVisible();
        },
      },
      {
        path: paths.billing,
        ready: () => expect(heading).toHaveText(copy.billing.title),
      },
      {
        path: paths.organizationsNew,
        ready: () => expect(heading).toHaveText(navigation.newOrganization),
      },
      {
        path: paths.login,
        ready: () => expect(heading).toHaveText(copy.auth.nativeTitle),
      },
      {
        path: state.setupUrl,
        ready: () => expect(heading).toHaveText(copy.auth.passwordSetupTitle),
      },
      {
        path: paths.forgotPassword,
        ready: () => expect(heading).toHaveText(copy.site.signup.resetTitle),
      },
      {
        path: paths.verifyEmail,
        ready: () => expect(heading).toHaveText(copy.site.signup.verifyEmail),
      },
      {
        path: paths.signup,
        ready: () => expect(heading).toHaveText(copy.site.signup.title),
      },
    ];
    for (const screen of screens) {
      await page.goto(screen.path);
      await screen.ready();
      await settled(page);
      await expect(page.getByRole("alert")).toHaveCount(0);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await accessible(page);
      await page.screenshot({
        path: info.outputPath(
          `${new URL(screen.path, "http://localhost").pathname.replaceAll("/", "_")}-${theme}.png`,
        ),
        fullPage: true,
      });
    }
    expect(errors).toEqual([]);
    const me = z
      .object({ organization: z.object({ id: z.string() }).nullable() })
      .parse(await (await page.request.get("/api/v1/me")).json());
    expect(me.organization?.id).toBe(state.organizationId);
  });
