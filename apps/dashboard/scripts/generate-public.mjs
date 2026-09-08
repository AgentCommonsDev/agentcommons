import { readFile, writeFile, mkdir } from "node:fs/promises";
const dist = new URL(
  process.env.DASHBOARD_DIST_DIR ?? "../dist/",
  import.meta.url,
);
const {
  renderDocument,
  appDocument,
  copy,
  links,
  posts,
  publicRoutes,
  defaultBillingConfig,
} = await import(new URL("prerender/entry-server.js", dist).href);
const html = await readFile(new URL("index.html", dist), "utf8");
await writeFile(new URL("template.html", dist), html);
await writeFile(new URL("app.html", dist), appDocument(html));
await mkdir(new URL("blog/", dist), { recursive: true });
for (const { path, file: output } of publicRoutes) {
  const document = await renderDocument(html, path, {
    ...defaultBillingConfig,
    mode: "public",
  });
  await writeFile(new URL(output, dist), document);
}
const guide = `# ${copy.publicGuide.title}\n\n${copy.publicGuide.sections.join("\n\n")}\n`;
const blogIndex = `\n## ${copy.blog.navigation}\n\n${posts.map((post) => `- [${post.title}](__PUBLIC_URL__/blog/${post.slug}): ${post.summary}`).join("\n")}\n`;
const blogFull = posts
  .map((post) => `# ${post.title}\n\n${post.date}\n\n${post.body}`)
  .join("\n\n");
const summary = `${guide}\n## ${copy.discovery.documentation}\n\n- [${copy.discovery.guide}](__PUBLIC_URL__/docs)\n- [${copy.footer.links.specification}](${links.specification})\n- [${copy.discovery.full}](__PUBLIC_URL__/llms-full.txt)\n`;
const readme = await readFile(
  new URL("../../../README.md", import.meta.url),
  "utf8",
);
await Promise.all([
  writeFile(new URL("llms.txt", dist), summary + blogIndex),
  writeFile(
    new URL("llms-full.txt", dist),
    `${guide}\n## ${copy.discovery.readme}\n\n${readme}\n\n${blogFull}`,
  ),
  writeFile(new URL("robots.txt", dist), "User-agent: *\nDisallow: /\n"),
  writeFile(
    new URL("sitemap.xml", dist),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${publicRoutes.map(({ path }) => `<url><loc>__PUBLIC_URL__${path}</loc></url>`).join("")}</urlset>\n`,
  ),
]);
