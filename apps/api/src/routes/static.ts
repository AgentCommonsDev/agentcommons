import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import {
  billingConfigSchema,
  defaultBillingConfig,
  type BillingConfig,
} from "@agentcommons/core/schemas/billing";
import {
  withPublicConfig,
  withScriptNonce,
} from "@agentcommons/core/format/public-config";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance, FastifyReply } from "fastify";
import { ServiceError } from "../services/context.js";

export async function registerStaticRoutes(
  app: FastifyInstance,
  options: {
    publicUrl: string;
    mode: BillingConfig["mode"];
    billingConfig?: BillingConfig;
    dashboardDirectory: string;
    artifactDirectory: string;
  },
): Promise<void> {
  const origin = options.publicUrl.replace(/\/$/, "");
  const config = billingConfigSchema.parse(
    options.billingConfig ?? {
      ...defaultBillingConfig,
      mode: options.mode,
      enabled: options.mode === "saas",
    },
  );
  const renderedDocuments = new Map<string, string>();
  let publicOffering = "";
  {
    type RenderDocument = (
      template: string,
      path: string,
      config: BillingConfig,
    ) => Promise<string>;
    const loaded: unknown = await import(
      pathToFileURL(
        resolve(options.dashboardDirectory, "prerender/entry-server.js"),
      ).href
    );
    const renderer = z
      .object({
        publicRoutes: z.array(z.object({ path: z.string(), file: z.string() })),
        renderDocument: z.custom<RenderDocument>(
          (value) => typeof value === "function",
        ),
        offeringText: z.custom<(config: BillingConfig) => string>(
          (value) => typeof value === "function",
        ),
      })
      .parse(loaded);
    publicOffering = z.string().parse(renderer.offeringText(config));
    const template = await readFile(
      resolve(options.dashboardDirectory, "template.html"),
      "utf8",
    );
    for (const { path, file } of renderer.publicRoutes)
      renderedDocuments.set(
        file,
        z.string().parse(await renderer.renderDocument(template, path, config)),
      );
  }
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
      withPublicConfig(
        renderedDocuments.get(file) ??
          (await readFile(resolve(options.dashboardDirectory, file), "utf8")),
        config,
      ),
    );
    html = withScriptNonce(html, nonce);
    if (indexable)
      html = html.replaceAll("noindex,nofollow,noarchive", "index,follow");
    reply.header(
      "Content-Security-Policy",
      `default-src 'self'; script-src 'self' 'nonce-${nonce}'${config.enabled && config.cal_com_url ? " https://app.cal.com" : ""}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'${config.enabled && config.cal_com_url ? " https://app.cal.com" : ""}; frame-src 'self'${config.enabled && config.cal_com_url ? ` ${new URL(config.cal_com_url).origin} https://app.cal.com` : ""}; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'`,
    );
    reply.header("Cache-Control", "no-cache");
    if (!indexable)
      reply.header("X-Robots-Tag", "noindex, nofollow, noarchive");
    return reply.type("text/html; charset=utf-8").send(html);
  };
  app.get("/", async (_request, reply) =>
    document("index.html", options.mode !== "customer", reply),
  );
  app.get("/docs", async (_request, reply) =>
    document("docs.html", options.mode !== "customer", reply),
  );
  // The legal documents describe the hosted service; like the blog, customer
  // instances do not serve them.
  for (const [path, file] of [
    ["/privacy", "privacy.html"],
    ["/tos", "tos.html"],
  ] as const)
    app.get(path, async (_request, reply) =>
      options.mode === "customer"
        ? reply.code(404).send()
        : document(file, true, reply),
    );
  const blogDocument = async (
    slug: string | undefined,
    reply: FastifyReply,
  ) => {
    if (
      options.mode === "customer" ||
      (slug !== undefined && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
    )
      return reply.code(404).send();
    try {
      return await document(
        slug ? `blog/${slug}.html` : "blog.html",
        true,
        reply,
      );
    } catch (error) {
      if (z.object({ code: z.literal("ENOENT") }).safeParse(error).success)
        return reply.code(404).send();
      throw error;
    }
  };
  app.get("/blog", async (_request, reply) => blogDocument(undefined, reply));
  app.get<{ Params: { slug: string } }>("/blog/:slug", async (request, reply) =>
    blogDocument(request.params.slug, reply),
  );
  app.get("/robots.txt", (_request, reply) =>
    reply
      .type("text/plain")
      .send(
        options.mode === "customer"
          ? "User-agent: *\nDisallow: /\n"
          : `User-agent: *\nAllow: /$\nAllow: /docs$\nAllow: /blog$\nAllow: /blog/\nAllow: /privacy$\nAllow: /tos$\nDisallow: /\nSitemap: ${origin}/sitemap.xml\n`,
      ),
  );
  for (const file of ["sitemap.xml", "llms.txt", "llms-full.txt"])
    app.get(`/${file}`, async (_request, reply) => {
      if (options.mode === "customer") return reply.code(404).send();
      return reply
        .type(file.endsWith(".xml") ? "application/xml" : "text/plain")
        .send(
          replacement(
            (await readFile(
              resolve(options.dashboardDirectory, file),
              "utf8",
            )) +
              (file.startsWith("llms") && publicOffering
                ? `\n\n${publicOffering}\n`
                : ""),
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
      !/^\/(api|auth|mcp|hook|assets|blog)(\/|$)/.test(request.url)
    )
      return document("app.html", false, reply);
    throw new ServiceError(
      404,
      "NOT_FOUND",
      "The requested resource was not found.",
    );
  });
}
