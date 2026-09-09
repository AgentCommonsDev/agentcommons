import { expect, it } from "vitest";
import { defaultBillingConfig } from "@agentcommons/core/schemas/billing";
import { publicConfigElementId } from "@agentcommons/core/format/public-config";
import { renderDocument, offeringText } from "../src/entry-server";
import { copy } from "../src/copy";
const template =
  '<html><head><title>AgentCommons</title><meta name="description" content="AgentCommons"><meta property="og:title" content="AgentCommons"><meta property="og:description" content="AgentCommons"><meta property="og:type" content="website"><link rel="canonical" href="__PUBLIC_URL__/"><script type="application/ld+json">{}</script></head><body><div id="root"></div></body></html>';

// @req R-SAAS-07 @req R-WEB-03
it("renders runtime plan allowances into actual React HTML and identical hydration configuration", async () => {
  const config = {
    ...defaultBillingConfig,
    mode: "saas" as const,
    enabled: true,
    plans: {
      free: { monthly_records: 42 },
      pro: {
        included_records: 840,
        monthly_price_usd: 100 as const,
        capture_usd_per_1000: null,
      },
      embeddings: defaultBillingConfig.plans.embeddings,
    },
  };
  const html = await renderDocument(template, "/", config);
  expect(html).toContain('id="pricing"');
  expect(html).toContain('href="/signup"');
  expect(html).toContain(">42<");
  expect(html).toContain(">840<");
  expect(html).toContain("$100");
  expect(html).toContain(copy.saas.calendarUnavailable);
  const serialized = new RegExp(
    `<script id="${publicConfigElementId}" type="application/json">(.*?)</script>`,
  ).exec(html)?.[1];
  expect(JSON.parse(serialized ?? "null")).toEqual(config);
  const guide = offeringText(config);
  expect(guide).toContain("42");
  expect(guide).toContain("840");
  expect(guide).toContain("$100.00 USD");
  expect(guide).not.toContain("1,000");
});

// @req R-SAAS-07 @req R-WEB-04
it("keeps pricing, signup links, and hosted discovery out of customer and public rendering", async () => {
  for (const mode of ["customer", "public"] as const) {
    const config = { ...defaultBillingConfig, mode };
    const html = await renderDocument(template, "/", config);
    expect(html).not.toContain('id="pricing"');
    expect(html).not.toContain('href="/signup"');
    expect(html).toContain('href="/login"');
    expect(offeringText(config)).toBe("");
  }
});

// @req R-WEB-09
it("prerenders the Privacy Policy and Terms of Service and links them from every public footer", async () => {
  const { publicRoutes } = await import("../src/entry-server");
  const documents = [
    { path: "/privacy", file: "privacy.html", document: copy.legal.privacy },
    { path: "/tos", file: "tos.html", document: copy.legal.terms },
  ];
  const config = { ...defaultBillingConfig, mode: "public" as const };
  for (const { path, file, document } of documents) {
    expect(publicRoutes).toContainEqual({ path, file });
    const html = await renderDocument(template, path, config);
    expect(html).toContain(`<title>${document.title} · ${copy.brand}</title>`);
    expect(html).toContain(`content="${document.description}"`);
    expect(html).toContain(`<h1>${document.title}</h1>`);
    expect(html).toContain(`<time dateTime="${document.effective}">`);
    for (const section of document.sections)
      expect(html).toContain(`>${section.heading}</h2>`);
    expect(html).toContain(`mailto:${copy.legal.contactEmail}`);
    expect(html).toContain(`href="__PUBLIC_URL__${path}"`);
  }
  for (const path of ["/", "/docs", "/blog", "/privacy", "/tos"]) {
    const html = await renderDocument(template, path, config);
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('href="/tos"');
  }
  // Customer instances neither link nor render the hosted-service documents.
  const customer = await renderDocument(
    template,
    "/privacy",
    defaultBillingConfig,
  );
  expect(customer).not.toContain('href="/tos"');
  expect(customer).toContain(copy.notFound.title);
});

// @req R-WEB-08
it("renders Markdown articles with real content, canonical metadata and native hydration", async () => {
  const { posts, publicRoutes } = await import("../src/entry-server");
  const post = posts[0];
  if (!post) throw new Error("At least one public blog post is required.");
  const path = `/blog/${post.slug}`;
  expect(publicRoutes).toContainEqual({ path, file: `blog/${post.slug}.html` });
  const html = await renderDocument(template, path, {
    ...defaultBillingConfig,
    mode: "public",
  });
  expect(html).toContain(post.title);
  const metadata = /<script type="application\/ld\+json">(.*?)<\/script>/.exec(
    html,
  )?.[1];
  expect(JSON.parse(metadata ?? "null")).toMatchObject({
    "@type": "BlogPosting",
    headline: post.title,
    datePublished: post.date,
  });
  expect(html).toContain('property="og:type" content="article"');
  expect(html).toContain("<h2>");
  expect(html).toContain(`href="__PUBLIC_URL__${path}"`);
  expect(html).toContain('href="/blog"');
  expect(html).toContain(publicConfigElementId);
  const customer = await renderDocument(template, "/", defaultBillingConfig);
  expect(customer).not.toContain('href="/blog"');
});
