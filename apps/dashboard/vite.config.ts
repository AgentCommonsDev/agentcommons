import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { copy } from "./src/copy";

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
    proxy: {
      "/api": "http://localhost:3000",
      "/auth": "http://localhost:3000",
      "/mcp": "http://localhost:3000",
    },
  },
  build: { outDir: "dist", sourcemap: true, target: "es2022" },
});
