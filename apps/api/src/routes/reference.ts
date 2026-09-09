import { readFile } from "node:fs/promises";
import scalar from "@scalar/fastify-api-reference";
import type { FastifyInstance } from "fastify";
import { withScriptNonce } from "@agentcommons/core/format/public-config";
import { scriptNonce } from "./context.js";

/** Native Scalar owns its renderer and bundle; route schemas remain the only API source. */
export async function registerApiReference(
  app: FastifyInstance,
): Promise<void> {
  // The bundled configuration script is a build artifact: read once, served unchanged.
  const configScript = await readFile(
    new URL("../../public/reference-config.js", import.meta.url),
    "utf8",
  );
  await app.register(async (scope) => {
    // The document stays uncompressed (see the onRoute hook in app.ts) so the response
    // nonce can be injected into the HTML string here.
    scope.addHook("onSend", async (_request, reply, payload) => {
      reply.header("X-Robots-Tag", "noindex, nofollow, noarchive");
      if (
        typeof payload !== "string" ||
        !String(reply.getHeader("content-type")).startsWith("text/html")
      )
        return payload;
      const nonce = scriptNonce();
      reply.header("Cache-Control", "no-store");
      reply.header(
        "Content-Security-Policy",
        `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'self'`,
      );
      return withScriptNonce(
        payload.replace(
          "</head>",
          '<script src="js/config.js"></script></head>',
        ),
        nonce,
      );
    });
    scope.get(
      "/api/docs/js/config.js",
      { schema: { hide: true } },
      (_request, reply) =>
        reply.type("application/javascript; charset=utf-8").send(configScript),
    );
    scope.get("/api/docs/json", { schema: { hide: true } }, () =>
      app.swagger(),
    );
    await scope.register(scalar, {
      routePrefix: "/api/docs",
      configuration: {
        url: "/api/docs/json",
        pageTitle: "AgentCommons API reference",
        theme: "default",
        withDefaultFonts: false,
        telemetry: false,
        agent: { disabled: true },
        mcp: { disabled: true },
        persistAuth: false,
        proxyUrl: "",
        hideClientButton: true,
        hideDarkModeToggle: true,
        showDeveloperTools: "never",
      },
    });
  });
}
