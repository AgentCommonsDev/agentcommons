import {
  escapeHtml,
  jsonForScript,
} from "@agentcommons/core/format/public-config";
import { copy } from "../copy";
import { publicPages, type PublicPage } from "./public-pages";

/** The head's placeholder in `index.html`; filled at prerender and by the dev server. */
export const headMarker = "<!--app-head-->";
const site = copy.site;
/** The landing page's head is the default for every document without its own page. */
const defaultPage: PublicPage = publicPages[0] ?? {
  path: "/",
  file: "index.html",
  title: site.meta.title,
  description: site.meta.description,
};
function structuredData(page: PublicPage): Record<string, unknown> {
  if (page.post)
    return {
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      headline: page.post.title,
      description: page.post.summary,
      datePublished: page.post.date,
      mainEntityOfPage: `__PUBLIC_URL__${page.path}`,
      author: { "@type": "Organization", name: site.brand },
      publisher: { "@type": "Organization", name: site.brand },
    };
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: site.brand,
    description: site.meta.description,
    applicationCategory: site.meta.applicationCategory,
    operatingSystem: site.meta.operatingSystem,
    url: "__PUBLIC_URL__/",
  };
}
/** Title, description, canonical, Open Graph and structured data for one public page. */
export function documentHead(page: PublicPage = defaultPage): string {
  const title = escapeHtml(page.title);
  const description = escapeHtml(page.description);
  const url = `__PUBLIC_URL__${page.path}`;
  return [
    `<title>${title}</title>`,
    `<meta name="description" content="${description}" />`,
    '<meta name="robots" content="noindex,nofollow,noarchive" />',
    `<link rel="canonical" href="${url}" />`,
    `<meta property="og:type" content="${page.post ? "article" : "website"}" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:url" content="${url}" />`,
    '<meta property="og:image" content="__PUBLIC_URL__/logo.png" />',
    `<script type="application/ld+json">${jsonForScript(structuredData(page))}</script>`,
  ].join("\n");
}
