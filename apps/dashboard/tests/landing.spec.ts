import { expect } from "@playwright/test";
import { accessible, activate, test } from "./browser-test";
import AxeBuilder from "@axe-core/playwright";
import { copy } from "../src/copy";
import { paths } from "../src/lib/routes";

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
      // The stored theme lands after hydration; the helper waits for that transition to
      // finish so axe does not compare one theme's text with the other's background.
      await accessible(page);
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
    page.getByText(copy.site.preview.get.rows[0].text, { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: /sql/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("table")).toBeVisible();
  await page.getByRole("button", { name: copy.app.common.theme.light }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  const menu = page.getByRole("button", { name: copy.app.navigation.menu });
  if (await menu.isVisible()) {
    await menu.click();
    await expect(
      page.getByRole("button", { name: copy.app.navigation.closeMenu }),
    ).toHaveAttribute("aria-expanded", "true");
    await page
      .getByRole("link", { name: copy.site.navigation.product, exact: true })
      .click();
    await expect(menu).toHaveAttribute("aria-expanded", "false");
  }
  await expect(
    page.getByRole("link", { name: copy.site.hero.primary }).first(),
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
    copy.site.hero.title,
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
    name: copy.site.brand,
  });
  expect(metadata).not.toHaveProperty("aggregateRating");
  expect(await (await request.get("/llms.txt")).text()).toContain(
    copy.site.publicGuide.sections[0],
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
  await expect(heading).toContainText(copy.site.hero.title);
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
  await page.waitForLoadState("load");
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

// @req R-SAAS-07
test("customer public pages hide hosted signup, pricing and email requests", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#pricing")).toHaveCount(0);
  await expect(page.locator('a[href="/signup"]')).toHaveCount(0);
  for (const path of [
    "/signup",
    "/forgot-password",
    "/verify-email",
    "/onboarding",
  ]) {
    await page.goto(path);
    await expect(
      page.getByText(copy.site.saas.unavailable, { exact: true }),
    ).toBeVisible();
    await expect(page.locator("form")).toHaveCount(0);
  }
});

// @req R-WEB-08 @req R-WEB-02
for (const theme of ["dark", "light"] as const)
  test(`Markdown blog navigation and article controls work in ${theme}`, async ({
    page,
    context,
  }, testInfo) => {
    const { default: posts } = await import("../src/lib/blog.generated.json", {
      with: { type: "json" },
    });
    const post = posts[0];
    if (!post) throw new Error("Missing public article");
    await page.addInitScript((value) => {
      localStorage.setItem("agentcommons-theme", value);
    }, theme);
    const input = testInfo.project.use.hasTouch ? "tap" : "click";
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/blog");
    await expect(
      page.getByRole("heading", { name: copy.site.blog.title, exact: true }),
    ).toBeVisible();
    await expect(page).toHaveScreenshot(`blog-${theme}.png`, {
      fullPage: true,
    });
    await page.getByRole("link", { name: post.title, exact: true })[input]();
    await expect(page).toHaveURL(new RegExp(`/blog/${post.slug}$`));
    await expect(
      page.getByRole("heading", { name: post.title, exact: true }),
    ).toBeVisible();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      `__PUBLIC_URL__/blog/${post.slug}`,
    );
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(testInfo.project.use.viewport?.width ?? 1440);
    expect(
      (await new AxeBuilder({ page }).analyze()).violations.filter((item) =>
        ["serious", "critical"].includes(item.impact ?? ""),
      ),
    ).toEqual([]);
    await expect(page).toHaveScreenshot(`blog-article-${theme}.png`, {
      fullPage: true,
    });
    await page
      .getByRole("link", { name: copy.site.blog.back, exact: true })
      [input]();
    await expect(page).toHaveURL(/\/blog$/);
    const sitemap = await context.request.get("/sitemap.xml");
    const llms = await context.request.get("/llms.txt");
    const full = await context.request.get("/llms-full.txt");
    for (const item of posts) {
      expect(await sitemap.text()).toContain(`/blog/${item.slug}`);
      expect(await llms.text()).toContain(item.title);
      expect(await full.text()).toContain(item.body);
    }
    expect(errors).toEqual([]);
  });

// @req R-WEB-08
test("Markdown blog article is complete without JavaScript", async ({
  browser,
}, testInfo) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: testInfo.project.use.viewport ?? { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  try {
    await page.goto(
      `${testInfo.project.use.baseURL ?? "http://127.0.0.1:4173"}/blog/shared-coding-history`,
    );
    await expect(
      page.getByRole("heading", {
        name: "Give the next agent the work you already did",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: "Keep durable instructions in version control",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Read the setup guide", exact: true }),
    ).toHaveAttribute("href", "/docs");
  } finally {
    await context.close();
  }
});

// @req R-WEB-09 @req R-WEB-02
for (const [path, document] of [
  [paths.privacy, copy.legal.privacy],
  [paths.tos, copy.legal.terms],
] as const)
  for (const theme of ["dark", "light"] as const)
    test(`${document.title} is complete, linked from the public footer and accessible in ${theme}`, async ({
      page,
      isMobile,
    }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      page.on("requestfailed", (request) => errors.push(request.url()));
      await page.addInitScript((value) => {
        localStorage.setItem("agentcommons-theme", value);
      }, theme);
      // Every public page's footer carries both documents.
      await page.goto("/");
      const footer = page.locator("footer");
      await expect(
        footer.getByRole("link", {
          name: copy.legal.privacy.title,
          exact: true,
        }),
      ).toHaveAttribute("href", paths.privacy);
      await expect(
        footer.getByRole("link", { name: copy.legal.terms.title, exact: true }),
      ).toHaveAttribute("href", paths.tos);
      await activate(
        footer.getByRole("link", { name: document.title, exact: true }),
        isMobile,
      );
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(page).toHaveTitle(`${document.title} · ${copy.site.brand}`);
      await expect(
        page.getByRole("heading", {
          level: 1,
          name: document.title,
          exact: true,
        }),
      ).toBeVisible();
      await expect(page.locator("main time")).toHaveAttribute(
        "datetime",
        document.effective,
      );
      for (const section of document.sections)
        await expect(
          page.getByRole("heading", {
            level: 2,
            name: section.heading,
            exact: true,
          }),
        ).toBeVisible();
      await expect(
        footer.getByRole("link", {
          name: copy.legal.privacy.title,
          exact: true,
        }),
      ).toHaveAttribute("href", paths.privacy);
      await expect(
        footer.getByRole("link", { name: copy.legal.terms.title, exact: true }),
      ).toHaveAttribute("href", paths.tos);
      await expect(
        page.getByRole("link", { name: copy.legal.contactEmail, exact: true }),
      ).toHaveAttribute("href", `mailto:${copy.legal.contactEmail}`);
      // The contents list jumps to a section on touch and pointer devices.
      const last = document.sections.at(-1);
      if (!last) throw new Error("Legal documents need sections");
      await activate(
        page
          .getByRole("navigation", { name: copy.legal.contents, exact: true })
          .getByRole("link", { name: last.heading, exact: true }),
        isMobile,
      );
      await expect(page).toHaveURL(/#contact$/);
      await accessible(page);
      expect(errors).toEqual([]);
    });
