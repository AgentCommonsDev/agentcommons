import { expect, type Locator } from "@playwright/test";
import { z } from "zod";
import { builtinDashboardId } from "@agentcommons/core/schemas/dashboards";
import { copy } from "../src/copy";
import { paths } from "../src/lib/routes";
import {
  accessible,
  collectErrors,
  fixture,
  setTheme,
  settled,
  statNumber,
  test,
} from "./browser-test";
import { installVisualTime } from "./visual-time";

// @req R-DASH-07 @req R-WEB-02
for (const theme of ["dark", "light"] as const)
  test(`dashboard visual baselines in ${theme}`, async ({ page, context }) => {
    const data = await fixture();
    await installVisualTime(page, data.visual.timeShiftMs);
    await context.clearCookies();
    await context.addCookies(data.visual.storageState.cookies);
    await setTheme(page, theme);
    const errors = collectErrors(page);
    // The visual organization's three sessions must be indexed before the
    // embeddings card is compared, otherwise its progress line still moves.
    await expect
      .poll(
        async () =>
          z
            .object({
              sessions_pending: z.number(),
              sessions_total: z.number(),
            })
            .parse(
              await (
                await page.request.get("/api/v1/organization/embeddings")
              ).json(),
            ),
        { timeout: 60_000 },
      )
      .toEqual({ sessions_pending: 0, sessions_total: 3 });
    const picker = page.getByTestId("dashboard-picker");
    const heading = page.getByRole("heading", { level: 1 });
    const dashboardReady = async () => {
      await expect(picker).toBeVisible();
      expect(
        await statNumber(page.getByTestId("dashboard-tile-captured_sessions")),
      ).toBe(3);
      for (const id of ["sessions_per_day", "harness_share"])
        await expect(
          page.getByTestId(`dashboard-tile-${id}`).locator("canvas"),
        ).toBeVisible({ timeout: 20_000 });
      await expect(
        page.getByText(copy.dashboards.status.rendered, { exact: false }),
      ).toBeVisible();
    };
    const screens: {
      name: string;
      path: string;
      ready: () => Promise<void>;
      mask: () => Locator[];
    }[] = [
      {
        name: "home",
        path: paths.home,
        ready: dashboardReady,
        mask: () => [
          page
            .locator("p")
            .filter({ hasText: copy.dashboards.status.rendered }),
        ],
      },
      {
        name: "dashboard",
        path: paths.dashboard(builtinDashboardId),
        ready: dashboardReady,
        mask: () => [
          page
            .locator("p")
            .filter({ hasText: copy.dashboards.status.rendered }),
        ],
      },
      {
        name: "users",
        path: paths.admin.users,
        ready: async () => {
          await expect(heading).toHaveText(copy.admin.users.title);
          await expect(
            page.getByTestId("admin-users-table").locator("tbody tr"),
          ).toHaveCount(2);
        },
        // Last seen is this run's own dashboard requests, made on the real weekday, so its
        // distance from the fixed Sunday clock changes with the day the suite runs.
        mask: () => [page.getByTestId("admin-users-table").locator("time")],
      },
      {
        name: "settings",
        path: paths.admin.settings,
        ready: async () => {
          await expect(heading).toHaveText(copy.settings.title);
          await expect(
            page
              .getByTestId("settings-default-dashboard")
              .getByRole("combobox"),
          ).toBeVisible();
          await expect(
            page.getByTestId("settings-embeddings").getByRole("switch"),
          ).toBeVisible();
          await expect(page.getByTestId("settings-domains")).toContainText(
            copy.settings.domains.empty,
          );
        },
        // Generated identifiers differ per fixture run.
        mask: () => [
          page
            .getByText(copy.settings.general.id, { exact: true })
            .locator("xpath=following-sibling::dd"),
        ],
      },
      {
        name: "login",
        path: paths.login,
        ready: () => expect(heading).toHaveText(copy.auth.nativeTitle),
        mask: () => [],
      },
    ];
    for (const screen of screens) {
      await page.goto(screen.path);
      await screen.ready();
      await settled(page);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(page.getByRole("alert")).toHaveCount(0);
      await accessible(page);
      await page.evaluate(() => {
        scrollTo(0, 0);
      });
      await expect(page).toHaveScreenshot(`${screen.name}-${theme}.png`, {
        fullPage: true,
        mask: screen.mask(),
      });
    }
    expect(errors).toEqual([]);
  });
