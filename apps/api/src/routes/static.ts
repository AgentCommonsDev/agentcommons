import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance, FastifyReply } from "fastify";
import { ServiceError } from "../services/context.js";

export async function registerStaticRoutes(
  app: FastifyInstance,
  options: {
    publicUrl: string;
    mode: "public" | "customer";
    dashboardDirectory: string;
    artifactDirectory: string;
  },
): Promise<void> {
  const origin = options.publicUrl.replace(/\/$/, "");
  await app.register(fastifyStatic, {
    root: resolve(options.dashboardDirectory, "assets"),
    prefix: "/assets/",
    immutable: true,
    maxAge: "1y",
    decorateReply: false,
  });
  const replacement = (source: string) =>
    source.replaceAll("__PUBLIC_URL__", origin);
  const document = async (
    file: string,
    indexable: boolean,
    reply: FastifyReply,
  ) => {
    const nonce = randomBytes(18).toString("base64");
    let html = replacement(
      await readFile(resolve(options.dashboardDirectory, file), "utf8"),
    );
    html = html.replaceAll(/<script\b/g, `<script nonce="${nonce}"`);
    if (indexable)
      html = html.replaceAll("noindex,nofollow,noarchive", "index,follow");
    reply.header(
      "Content-Security-Policy",
      `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'`,
    );
    reply.header("Cache-Control", "no-cache");
    if (!indexable)
      reply.header("X-Robots-Tag", "noindex, nofollow, noarchive");
    return reply.type("text/html; charset=utf-8").send(html);
  };
  app.get("/", async (_request, reply) =>
    document("index.html", options.mode === "public", reply),
  );
  app.get("/docs", async (_request, reply) =>
    document("docs.html", options.mode === "public", reply),
  );
  app.get("/robots.txt", (_request, reply) =>
    reply
      .type("text/plain")
      .send(
        options.mode === "customer"
          ? "User-agent: *\nDisallow: /\n"
          : `User-agent: *\nAllow: /$\nAllow: /docs$\nDisallow: /\nSitemap: ${origin}/sitemap.xml\n`,
      ),
  );
  for (const file of ["sitemap.xml", "llms.txt", "llms-full.txt"])
    app.get(`/${file}`, async (_request, reply) => {
      if (options.mode !== "public") return reply.code(404).send();
      return reply
        .type(file.endsWith(".xml") ? "application/xml" : "text/plain")
        .send(
          replacement(
            await readFile(resolve(options.dashboardDirectory, file), "utf8"),
          ),
        );
    });
  app.get("/logo.png", async (_request, reply) =>
    reply
      .type("image/png")
      .header("Cache-Control", "public, max-age=3600")
      .send(await readFile(resolve(options.dashboardDirectory, "logo.png"))),
  );
  app.get("/install.sh", async (_request, reply) =>
    reply
      .type("text/plain")
      .send(
        replacement(
          await readFile(
            resolve(options.artifactDirectory, "install.sh"),
            "utf8",
          ),
        ),
      ),
  );
  await app.register(fastifyStatic, {
    root: resolve(options.artifactDirectory, "hook"),
    prefix: "/hook/",
    decorateReply: false,
    cacheControl: false,
    setHeaders(response, path) {
      response.setHeader(
        "cache-control",
        path.endsWith("manifest.json")
          ? "no-cache"
          : "public, max-age=31536000, immutable",
      );
    },
  });
  app.setNotFoundHandler(async (request, reply) => {
    if (
      request.method === "GET" &&
      !/^\/(api|auth|mcp|hook|assets)(\/|$)/.test(request.url)
    )
      return document("app.html", false, reply);
    throw new ServiceError(
      404,
      "NOT_FOUND",
      "The requested resource was not found.",
    );
  });
}
