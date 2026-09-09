import { copy } from "../copy";
import posts from "./blog.generated.json";
import { paths } from "./routes";

export interface PublicPage {
  path: string;
  /** Output file under the dashboard `dist/` directory. */
  file: string;
  title: string;
  description: string;
  /** Present for blog articles; drives the BlogPosting structured data. */
  post?: (typeof posts)[number];
}
const site = copy.site;
/**
 * Every prerendered public page. The prerender script, the API's static routes, the
 * document head and the client's hydration check all read this one table.
 */
export const publicPages: readonly PublicPage[] = [
  {
    path: paths.site,
    file: "index.html",
    title: site.meta.title,
    description: site.meta.description,
  },
  {
    path: paths.docs,
    file: "docs.html",
    title: `${site.publicGuide.title} · ${site.brand}`,
    description: site.meta.description,
  },
  {
    path: paths.blog,
    file: "blog.html",
    title: `${site.blog.title} · ${site.brand}`,
    description: site.blog.description,
  },
  ...posts.map((post) => ({
    path: paths.blogPost(post.slug),
    file: `blog/${post.slug}.html`,
    title: `${post.title} · ${site.brand}`,
    description: post.summary,
    post,
  })),
  {
    path: paths.privacy,
    file: "privacy.html",
    title: `${copy.legal.privacy.title} · ${site.brand}`,
    description: copy.legal.privacy.description,
  },
  {
    path: paths.tos,
    file: "tos.html",
    title: `${copy.legal.terms.title} · ${site.brand}`,
    description: copy.legal.terms.description,
  },
];
export function publicPage(path: string): PublicPage | undefined {
  return publicPages.find((page) => page.path === path);
}
/** Whether the server ships this path with prerendered markup the client should hydrate. */
export function isPrerendered(pathname: string): boolean {
  const path = pathname.replace(/\/$/, "") || "/";
  return publicPage(path) !== undefined;
}
