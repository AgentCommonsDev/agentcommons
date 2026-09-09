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
import { withPublicConfig } from "@agentcommons/core/format/public-config";
import { copy, links } from "./copy";
import { formatPlans } from "@agentcommons/core/format/billing";
import { documentHead, headMarker } from "./lib/document-head";
import { publicPage, publicPages } from "./lib/public-pages";
import posts from "./lib/blog.generated.json";
export { copy, links, posts, defaultBillingConfig };
/** The prerender script and the API's static routes read this `{ path, file }` list. */
export const publicRoutes = publicPages.map(({ path, file }) => ({
  path,
  file,
}));
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

/** The application document: the landing page's head, no prerendered markup. */
export function appDocument(
  template: string,
  config: BillingConfig = defaultBillingConfig,
) {
  return withPublicConfig(
    template.replace(headMarker, () => documentHead()),
    config,
  );
}
/** One public page prerendered into the template with its own head. */
export async function renderDocument(
  template: string,
  path = "/",
  config: BillingConfig = defaultBillingConfig,
) {
  const rendered = await render(path, config);
  return withPublicConfig(template, config)
    .replace(headMarker, () => documentHead(publicPage(path)))
    .replace(
      '<div id="root"></div>',
      () => `<div id="root">${rendered.html}</div>`,
    )
    .replace("</body>", () => `${rendered.bootstrap ?? ""}</body>`);
}

const site = copy.site;
export function offeringText(config: BillingConfig): string {
  if (!config.enabled) return "";
  const plans = formatPlans(config);
  return [
    `## ${site.saas.pricing}`,
    `${site.saas.free}: ${site.saas.freePrice} ${site.saas.perMonth}; ${plans.freeAllowance} ${site.saas.sessionsPerMonth}.`,
    `${site.saas.pro}: ${plans.proPrice} ${site.saas.currency} ${site.saas.perMonth}; ${plans.proAllowance} ${site.saas.sessionsPerMonth}.`,
    plans.captureRate
      ? `${plans.captureRate} ${site.saas.captureRate}.`
      : site.saas.rateUnavailable,
    `${site.saas.embeddingsAddon}: ${plans.embeddingPrice} ${site.saas.perMonth}; ${plans.embeddingRate ?? site.saas.rateUnavailable} ${plans.embeddingRate ? site.saas.embeddingRate : ""}.`,
    site.saas.counting,
    `${site.saas.signup}: __PUBLIC_URL__/signup`,
    config.checkout_enabled ? "" : site.saas.checkoutUnavailable,
    config.cal_com_url
      ? `${site.saas.demo}: ${new URL(config.cal_com_url).href}`
      : site.saas.calendarUnavailable,
  ]
    .filter(Boolean)
    .join("\n\n");
}
