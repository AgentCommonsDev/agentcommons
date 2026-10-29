import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import {
  billingConfigSchema,
  type BillingConfig,
} from "@agentcommons/core/schemas/billing";
import {
  withPublicConfig,
  withScriptNonce,
} from "@agentcommons/core/format/public-config";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance, FastifyReply } from "fastify";
import { ServiceError } from "../services/context.js";
import { scriptNonce } from "./context.js";

const missingFileSchema = z.object({ code: z.literal("ENOENT") });
const NOINDEX = "noindex, nofollow, noarchive";

/** Build artifacts are immutable for the process lifetime: each is read and prepared once. */
function memo<T>(
  cache: Map<string, Promise<T>>,
  key: string,
  load: () => Promise<T>,
): Promise<T> {
  const existing = cache.get(key);
  if (existing) return existing;
  const value = load();
  cache.set(key, value);
  // A missing artifact is not cached, so a later request still reports it.
  void value.catch(() => cache.delete(key));
  return value;
}

export async function registerStaticRoutes(
  app: FastifyInstance,
  options: {
    publicUrl: string;
    billingConfig: BillingConfig;
    dashboardDirectory: string;
    artifactDirectory: string;
  },
): Promise<void> {
  const origin = options.publicUrl.replace(/\/$/, "");
  const config = billingConfigSchema.parse(options.billingConfig);
  // Self-hosted instances have no public site: the root goes straight to the app, the
  // legal documents, blog and discovery files are not served, and nothing is indexable.
  const customer = config.mode === "customer";
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
  const documents = new Map<string, Promise<string>>();
  const texts = new Map<string, Promise<string>>();
  const binaries = new Map<string, Promise<Buffer>>();
  /** A document with its public config, origin and robots meta resolved; only the nonce varies. */
  const preparedDocument = (file: string, indexable: boolean) =>
    memo(documents, `${file}:${String(indexable)}`, async () => {
      const html = replacement(
        withPublicConfig(
          renderedDocuments.get(file) ??
            (await readFile(resolve(options.dashboardDirectory, file), "utf8")),
          config,
        ),
      );
      return indexable
        ? html.replaceAll("noindex,nofollow,noarchive", "index,follow")
        : html;
    });
  const calCom =
    config.enabled && config.cal_com_url
      ? {
          app: " https://app.cal.com",
          frame: ` ${new URL(config.cal_com_url).origin} https://app.cal.com`,
        }
      : { app: "", frame: "" };
  const csp = (nonce: string) =>
    `default-src 'self'; script-src 'self' 'nonce-${nonce}'${calCom.app}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'${calCom.app}; frame-src 'self'${calCom.frame}; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'`;
  /** Indexable pages and discovery files drop the instance-wide noindex header app.ts sets. */
  const indexable = (reply: FastifyReply) => {
    reply.removeHeader("X-Robots-Tag");
    return reply;
  };
  const document = async (
    file: string,
    index: boolean,
    reply: FastifyReply,
  ) => {
    const nonce = scriptNonce();
    const html = withScriptNonce(await preparedDocument(file, index), nonce);
    reply.header("Content-Security-Policy", csp(nonce));
    reply.header("Cache-Control", "no-cache");
    if (index) indexable(reply);
    else reply.header("X-Robots-Tag", NOINDEX);
    return reply.type("text/html; charset=utf-8").send(html);
  };
  app.get("/", async (_request, reply) =>
    customer
      ? reply.redirect("/app", 302)
      : document("index.html", true, reply),
  );
  app.get("/docs", async (_request, reply) =>
    document("docs.html", !customer, reply),
  );
  // The legal documents describe the hosted service; like the blog, customer
  // instances do not serve them.
  for (const [path, file] of [
    ["/privacy", "privacy.html"],
    ["/tos", "tos.html"],
  ] as const)
    app.get(path, async (_request, reply) =>
      customer ? reply.code(404).send() : document(file, true, reply),
    );
  const blogDocument = async (
    slug: string | undefined,
    reply: FastifyReply,
  ) => {
    if (
      customer ||
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
      if (missingFileSchema.safeParse(error).success)
        return reply.code(404).send();
      throw error;
    }
  };
  app.get("/blog", async (_request, reply) => blogDocument(undefined, reply));
  app.get<{ Params: { slug: string } }>("/blog/:slug", async (request, reply) =>
    blogDocument(request.params.slug, reply),
  );
  app.get("/robots.txt", (_request, reply) =>
    customer
      ? reply.type("text/plain").send("User-agent: *\nDisallow: /\n")
      : indexable(reply)
          .type("text/plain")
          .send(
            `User-agent: *\nAllow: /$\nAllow: /docs$\nAllow: /blog$\nAllow: /blog/\nAllow: /privacy$\nAllow: /tos$\nDisallow: /\nSitemap: ${origin}/sitemap.xml\n`,
          ),
  );
  for (const file of ["sitemap.xml", "llms.txt", "llms-full.txt"])
    app.get(`/${file}`, async (_request, reply) => {
      if (customer) return reply.code(404).send();
      const text = await memo(texts, file, async () =>
        replacement(
          (await readFile(resolve(options.dashboardDirectory, file), "utf8")) +
            (file.startsWith("llms") && publicOffering
              ? `\n\n${publicOffering}\n`
              : ""),
        ),
      );
      return indexable(reply)
        .type(file.endsWith(".xml") ? "application/xml" : "text/plain")
        .send(text);
    });
  app.get("/logo.png", async (_request, reply) =>
    reply
      .type("image/png")
      .header("Cache-Control", "public, max-age=3600")
      .send(
        await memo(binaries, "logo.png", () =>
          readFile(resolve(options.dashboardDirectory, "logo.png")),
        ),
      ),
  );
  app.get("/install.sh", async (_request, reply) =>
    reply
      .type("text/plain")
      .send(
        await memo(texts, "install.sh", async () =>
          replacement(
            await readFile(
              resolve(options.artifactDirectory, "install.sh"),
              "utf8",
            ),
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
      // The manifest and its release signature (ADR 0102) name the current release; every
      // other file sits under a version directory and never changes.
      response.setHeader(
        "cache-control",
        /[\\/]manifest\.json(\.sig)?$/.test(path)
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
