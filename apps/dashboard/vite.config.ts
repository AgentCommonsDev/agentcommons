import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import type { documentHead, headMarker } from "./src/lib/document-head";

const apiOrigin =
  process.env.AGENTCOMMONS_API_ORIGIN ?? "http://localhost:3000";
/** Type-only: the module itself is loaded through the dev server's resolver below. */
interface DocumentHeadModule {
  documentHead: typeof documentHead;
  headMarker: typeof headMarker;
}
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      // The dev server fills the head with the landing page's tags. Built documents keep
      // the marker so the prerender step writes each public page's own head. The head
      // module reaches into the shared core package, so the dev server's own module
      // loader resolves it rather than this config file.
      name: "agentcommons-document-head",
      apply: "serve",
      transformIndexHtml: async (html, context) => {
        if (!context.server) return html;
        const { documentHead, headMarker } =
          (await context.server.ssrLoadModule(
            "/src/lib/document-head.ts",
          )) as unknown as DocumentHeadModule;
        return html.replace(headMarker, () => documentHead());
      },
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
