import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { copy } from "../src/copy";

// @req R-DASH-07
// @req R-WEB-02
for (const theme of ["dark", "light"] as const) {
  test(`landing and guide are accessible in ${theme} theme`, async ({
    page,
  }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("requestfailed", (request) => errors.push(request.url()));
    await page.addInitScript((value) => {
      localStorage.setItem("agentcommons-theme", value);
    }, theme);
    for (const path of ["/", "/docs"]) {
      await page.goto(path);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(page.locator("h1")).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      const report = await new AxeBuilder({ page }).analyze();
      expect(
        report.violations.filter((violation) =>
          ["serious", "critical"].includes(violation.impact ?? ""),
        ),
      ).toEqual([]);
      await expect(page).toHaveScreenshot(
        `${path === "/" ? "landing" : "guide"}-${theme}.png`,
        { fullPage: true },
      );
      await page.screenshot({
        path: testInfo.outputPath(
          `${path === "/" ? "landing" : path.slice(1)}-${theme}.png`,
        ),
        fullPage: true,
      });
    }
    expect(errors).toEqual([]);
  });
}

test("example tabs work with keyboard and theme survives reload", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("tab", { name: /search/ }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: /get/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(
    page.getByText(copy.preview.get.rows[0].text, { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: /sql/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("table")).toBeVisible();
  await page.getByRole("button", { name: copy.theme.light }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  const menu = page.getByRole("button", { name: copy.navigation.menu });
  if (await menu.isVisible()) {
    await menu.click();
    await expect(
      page.getByRole("button", { name: copy.navigation.close }),
    ).toHaveAttribute("aria-expanded", "true");
    await page
      .getByRole("link", { name: copy.navigation.product, exact: true })
      .click();
    await expect(menu).toHaveAttribute("aria-expanded", "false");
  }
  await expect(
    page.getByRole("link", { name: copy.hero.primary }).first(),
  ).toHaveAttribute("href", "/login");
});

// @req R-WEB-01
// @req R-WEB-03
test("landing is readable without JavaScript and discovery is public documentation only", async ({
  browser,
  request,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    copy.hero.title,
  );
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    "noindex,nofollow,noarchive",
  );
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "__PUBLIC_URL__/",
  );
  const metadata: unknown = JSON.parse(
    (await page.locator('script[type="application/ld+json"]').textContent()) ??
      "null",
  );
  expect(metadata).toMatchObject({
    "@type": "SoftwareApplication",
    name: copy.brand,
  });
  expect(metadata).not.toHaveProperty("aggregateRating");
  expect(await (await request.get("/llms.txt")).text()).toContain(
    copy.publicGuide.sections[0],
  );
  expect(await (await request.get("/llms-full.txt")).text()).toContain(
    "# AgentCommons",
  );
  expect(await (await request.get("/robots.txt")).text()).toBe(
    "User-agent: *\nDisallow: /\n",
  );
  expect(await (await request.get("/sitemap.xml")).text()).not.toContain(
    "/sessions",
  );
  await context.close();
});

// @req R-WEB-01
test("native hydration preserves the prerendered content and layout", async ({
  page,
}) => {
  let release: () => void = () => {
    throw new Error("Script gate was not initialized");
  };
  const scriptsReady = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/assets/*.js", async (route) => {
    await scriptsReady;
    await route.continue();
  });
  await page.goto("/", { waitUntil: "commit" });
  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toContainText(copy.hero.title);
  await page.evaluate(() => document.fonts.ready);
  const original = await heading.elementHandle();
  const before = await heading.evaluate((node) => {
    const box = node.getBoundingClientRect();
    return {
      x: box.x + scrollX,
      y: box.y + scrollY,
      width: box.width,
      height: box.height,
    };
  });
  release();
  await page.getByRole("tab", { name: /get/ }).click();
  await expect(page.getByRole("tab", { name: /get/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(await original.evaluate((node) => node.isConnected)).toBe(true);
  expect(
    await heading.evaluate((node) => {
      const box = node.getBoundingClientRect();
      return {
        x: box.x + scrollX,
        y: box.y + scrollY,
        width: box.width,
        height: box.height,
      };
    }),
  ).toEqual(before);
  await expect(page.locator("header")).toHaveCount(1);
});
