import { createMemoryHistory } from "@tanstack/react-router";
import {
  attachRouterServerSsrUtils,
  RouterServer,
} from "@tanstack/react-router/ssr/server";
import { renderToString } from "react-dom/server";
import { makeRouter } from "./router";
import { BillingProvider } from "./lib/billing-config";
import {
  defaultBillingConfig,
  type BillingConfig,
} from "@agentcommons/core/schemas/billing";
import { copy, links } from "./copy";
import { formatPlans } from "@agentcommons/core/format/billing";
import posts from "./lib/blog.generated.json";
export { copy, links, posts, defaultBillingConfig };
export const publicRoutes = [
  { path: "/", file: "index.html" },
  { path: "/docs", file: "docs.html" },
  { path: "/blog", file: "blog.html" },
  ...posts.map((post) => ({
    path: `/blog/${post.slug}`,
    file: `blog/${post.slug}.html`,
  })),
];
const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
async function render(
  path = "/",
  billingConfig: BillingConfig = defaultBillingConfig,
) {
  const router = makeRouter(createMemoryHistory({ initialEntries: [path] }));
  attachRouterServerSsrUtils({ router, manifest: undefined });
  await router.load();
  if (!router.serverSsr) throw new Error("Missing router SSR utilities");
  await router.serverSsr.dehydrate();
  const html = renderToString(
    <BillingProvider config={billingConfig}>
      <RouterServer router={router} />
    </BillingProvider>,
  );
  router.serverSsr.setRenderFinished();
  const bootstrap = router.serverSsr.takeBufferedHtml();
  router.serverSsr.cleanup();
  return { html, bootstrap };
}

import { withPublicConfig } from "@agentcommons/core/format/public-config";
export function appDocument(
  template: string,
  config: BillingConfig = defaultBillingConfig,
) {
  return withPublicConfig(template, config);
}
export async function renderDocument(
  template: string,
  path = "/",
  config: BillingConfig = defaultBillingConfig,
) {
  const rendered = await render(path, config);
  const post = posts.find((item) => path === `/blog/${item.slug}`);
  const title = post
    ? `${post.title} · ${copy.brand}`
    : path === "/blog"
      ? `${copy.blog.title} · ${copy.brand}`
      : path === "/docs"
        ? `${copy.publicGuide.title} · ${copy.brand}`
        : copy.meta.title;
  const description =
    post?.summary ??
    (path === "/blog" ? copy.blog.description : copy.meta.description);
  const document = withPublicConfig(template, config)
    .replace(
      /<title>[^<]*<\/title>/,
      () => `<title>${escapeHtml(title)}</title>`,
    )
    .replace(
      /(<meta name="description" content=")[^"]*/,
      (_match, prefix: string) => `${prefix}${escapeHtml(description)}`,
    )
    .replace(
      /(<meta property="og:title" content=")[^"]*/,
      (_match, prefix: string) => `${prefix}${escapeHtml(title)}`,
    )
    .replace(
      /(<meta property="og:description" content=")[^"]*/,
      (_match, prefix: string) => `${prefix}${escapeHtml(description)}`,
    )
    .replace(
      '<div id="root"></div>',
      () => `<div id="root">${rendered.html}</div>`,
    )
    .replace("</body>", () => `${rendered.bootstrap ?? ""}</body>`)
    .replace(
      'rel="canonical" href="__PUBLIC_URL__/"',
      `rel="canonical" href="__PUBLIC_URL__${path}"`,
    )
    .replace(
      'property="og:url" content="__PUBLIC_URL__/"',
      `property="og:url" content="__PUBLIC_URL__${path}"`,
    );
  if (!post) return document;
  const metadata = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.summary,
    datePublished: post.date,
    mainEntityOfPage: `__PUBLIC_URL__${path}`,
    author: { "@type": "Organization", name: copy.brand },
    publisher: { "@type": "Organization", name: copy.brand },
  }).replaceAll("<", "\\u003c");
  return document
    .replace(
      'property="og:type" content="website"',
      'property="og:type" content="article"',
    )
    .replace(
      /<script type="application\/ld\+json">[\s\S]*?<\/script>/,
      () => `<script type="application/ld+json">${metadata}</script>`,
    );
}

export function offeringText(config: BillingConfig): string {
  if (!config.enabled) return "";
  const plans = formatPlans(config);
  return [
    `## ${copy.saas.pricing}`,
    `${copy.saas.free}: ${copy.saas.freePrice} ${copy.saas.perMonth}; ${plans.freeAllowance} ${copy.saas.sessionsPerMonth}.`,
    `${copy.saas.pro}: ${plans.proPrice} ${copy.saas.currency} ${copy.saas.perMonth}; ${plans.proAllowance} ${copy.saas.sessionsPerMonth}.`,
    plans.captureRate
      ? `${plans.captureRate} ${copy.saas.captureRate}.`
      : copy.saas.rateUnavailable,
    `${copy.saas.embeddingsAddon}: ${plans.embeddingPrice} ${copy.saas.perMonth}; ${plans.embeddingRate ?? copy.saas.rateUnavailable} ${plans.embeddingRate ? copy.saas.embeddingRate : ""}.`,
    copy.saas.counting,
    `${copy.saas.signup}: __PUBLIC_URL__/signup`,
    config.checkout_enabled ? "" : copy.saas.checkoutUnavailable,
    config.cal_com_url
      ? `${copy.saas.demo}: ${new URL(config.cal_com_url).href}`
      : copy.saas.calendarUnavailable,
  ]
    .filter(Boolean)
    .join("\n\n");
}
