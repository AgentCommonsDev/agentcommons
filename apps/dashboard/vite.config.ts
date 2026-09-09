import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { copy } from "./src/copy";

const apiOrigin =
  process.env.AGENTCOMMONS_API_ORIGIN ?? "http://localhost:3000";
const escape = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;");
const head = [
  `<title>${escape(copy.meta.title)}</title>`,
  `<meta name="description" content="${escape(copy.meta.description)}" />`,
  '<meta name="robots" content="noindex,nofollow,noarchive" />',
  '<link rel="canonical" href="__PUBLIC_URL__/" />',
  '<meta property="og:type" content="website" />',
  `<meta property="og:title" content="${escape(copy.meta.title)}" />`,
  `<meta property="og:description" content="${escape(copy.meta.description)}" />`,
  '<meta property="og:url" content="__PUBLIC_URL__/" />',
  '<meta property="og:image" content="__PUBLIC_URL__/logo.png" />',
  `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "SoftwareApplication", name: copy.brand, description: copy.meta.description, applicationCategory: copy.meta.applicationCategory, operatingSystem: copy.meta.operatingSystem, url: "__PUBLIC_URL__/" }).replaceAll("<", "\\u003c")}</script>`,
].join("\n");
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "agentcommons-document-copy",
      transformIndexHtml: (html) => html.replace("<!--app-head-->", head),
    },
  ],
  server: {
    port: 5173,
    proxy: Object.fromEntries(
      ["/api", "/auth", "/mcp"].map((path) => [
        path,
        {
          target: apiOrigin,
          // The API only accepts browser writes from its own public origin; the dev
          // server stands in for that origin, whatever port it runs on.
          configure: (proxy: {
            on(
              event: "proxyReq",
              listener: (request: {
                setHeader(name: string, value: string): void;
              }) => void,
            ): void;
          }) => {
            proxy.on("proxyReq", (request) => {
              request.setHeader("origin", apiOrigin);
              request.setHeader("referer", `${apiOrigin}/`);
            });
          },
        },
      ]),
    ),
  },
  build: { outDir: "dist", sourcemap: true, target: "es2022" },
});
