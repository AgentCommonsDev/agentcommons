import { readFile, writeFile, rm } from "node:fs/promises";
import { render, copy, links } from "../dist/prerender/entry-server.js";

const dist = new URL("../dist/", import.meta.url);
const html = await readFile(new URL("index.html", dist), "utf8");
await writeFile(new URL("app.html", dist), html);
for (const [path, output] of [
  ["/", "index.html"],
  ["/docs", "docs.html"],
]) {
  const rendered = await render(path);
  const document = html
    .replace('<div id="root"></div>', `<div id="root">${rendered.html}</div>`)
    .replace("</body>", `${rendered.bootstrap}</body>`)
    .replace(
      'rel="canonical" href="__PUBLIC_URL__/"',
      `rel="canonical" href="__PUBLIC_URL__${path}"`,
    )
    .replace(
      'property="og:url" content="__PUBLIC_URL__/"',
      `property="og:url" content="__PUBLIC_URL__${path}"`,
    );
  await writeFile(new URL(output, dist), document);
}
const guide = `# ${copy.publicGuide.title}\n\n${copy.publicGuide.sections.join("\n\n")}\n`;
const summary = `${guide}\n## ${copy.discovery.documentation}\n\n- [${copy.discovery.guide}](__PUBLIC_URL__/docs)\n- [${copy.footer.links.specification}](${links.specification})\n- [${copy.discovery.full}](__PUBLIC_URL__/llms-full.txt)\n`;
const readme = await readFile(
  new URL("../../../README.md", import.meta.url),
  "utf8",
);
await Promise.all([
  writeFile(new URL("llms.txt", dist), summary),
  writeFile(
    new URL("llms-full.txt", dist),
    `${guide}\n## ${copy.discovery.readme}\n\n${readme}`,
  ),
  writeFile(new URL("robots.txt", dist), "User-agent: *\nDisallow: /\n"),
  writeFile(
    new URL("sitemap.xml", dist),
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>__PUBLIC_URL__/</loc></url><url><loc>__PUBLIC_URL__/docs</loc></url></urlset>\n',
  ),
]);
await rm(new URL("prerender/", dist), { recursive: true });
