import type { DestinationStream } from "pino";
import { loggerOptions } from "./logger.js";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import compress from "@fastify/compress";
import { registerApiReference } from "./routes/reference.js";
import { hasZodFastifySchemaValidationErrors } from "fastify-type-provider-zod";
import { z } from "zod";
import qs from "qs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { errorSchema } from "@agentcommons/core/schemas";
import type { Env } from "./env.js";
import type { Services } from "./routes/services.js";
import {
  requestContext,
  requestHeaders,
  setRequestContext,
} from "./routes/context.js";
import { registerContract } from "./routes/openapi.js";
import {
  registerRequestDecompression,
  INFLATED_LIMIT,
} from "./routes/compression.js";
import { createRateLimiter } from "./routes/rate-limit.js";
import { registerPublicApiRoutes } from "./routes/public.js";
import { registerApiRoutes } from "./routes/api.js";
import { domainEnrollmentEnabled } from "./auth/config.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerStaticRoutes } from "./routes/static.js";
import { McpService } from "./services/mcp.js";
import { registerMcpRoutes } from "./mcp/index.js";
import { auditFailure, auditUnavailableError } from "./services/audit.js";
import { ServiceError } from "./services/context.js";

export { assertRouteContract } from "./routes/openapi.js";
/** Declared on each route at registration; unmatched `/api/v1` paths stay protected. */
function protectedRequest(request: FastifyRequest, path: string): boolean {
  return request.routeOptions.config.protected ?? path.startsWith("/api/v1/");
}
const statusSchema = z.looseObject({ statusCode: z.number().optional() });
function nativePath(request: FastifyRequest): string {
  return new URL(request.url, "http://localhost").pathname;
}

export async function createApp(options: {
  env: Env;
  services: Services;
  dashboardDirectory?: string;
  artifactDirectory?: string;
  static?: boolean;
  loggerStream?: DestinationStream;
}): Promise<FastifyInstance> {
  const { env, services } = options;
  const app = Fastify({
    bodyLimit: INFLATED_LIMIT,
    trustProxy: env.TRUST_PROXY,
    exposeHeadRoutes: false,
    logger: loggerOptions(env.LOG_LEVEL, options.loggerStream),
    genReqId: () => randomUUID(),
    routerOptions: {
      querystringParser: (source) =>
        qs.parse(source, {
          allowPrototypes: false,
          plainObjects: true,
          depth: 5,
          parameterLimit: 500,
          arrayLimit: 100,
        }),
    },
  });
  await registerContract(app, env.PUBLIC_URL);
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: env.PUBLIC_URL,
    credentials: true,
    exposedHeaders: ["X-Next-Cursor", "Retry-After"],
  });
  // Registered before the compression plugin so its onRoute hook sees the flag: the
  // API reference document receives a response nonce and must stay uncompressed.
  app.addHook("onRoute", (route) => {
    if (route.url === "/api/docs/")
      route.config = { ...route.config, compress: false };
  });
  await app.register(compress, {
    global: true,
    encodings: ["gzip", "deflate"],
    globalDecompression: false,
  });
  await registerApiReference(app);
  const limit = await createRateLimiter(app);
  app.addHook("onRequest", async (request, reply) => {
    const path = nativePath(request);
    const context = {
      caller: null,
      requestId: request.id,
      transport: path === "/mcp" ? ("mcp" as const) : ("rest" as const),
      ip: request.ip,
      userAgent: request.headers["user-agent"] ?? null,
      startedAt: Date.now(),
      headers: requestHeaders(request),
    };
    setRequestContext(request, context);
    // Nothing is indexable by default; the static routes lift this for public pages.
    reply.header("X-Robots-Tag", "noindex, nofollow, noarchive");
    if (path.startsWith("/auth/")) await limit(request, "auth");
    if (path === "/mcp" && request.method !== "POST") return;
    if (protectedRequest(request, path)) {
      if (
        path === "/mcp" &&
        !/^Bearer \S+$/i.test(context.headers.get("authorization") ?? "")
      )
        throw new ServiceError(
          401,
          "BEARER_REQUIRED",
          "Use an organization bearer API key for MCP.",
        );
      const identity = await services.auth.authenticate(
        context.headers,
        context,
      );
      setRequestContext(request, {
        ...context,
        caller: identity.caller,
        principal: identity,
      });
      await limit(request, request.routeOptions.config.rate ?? "read");
    }
    if (
      !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
      (context.headers.has("cookie") || path.startsWith("/auth/"))
    ) {
      const origin = context.headers.get("origin");
      if (
        origin !== new URL(env.PUBLIC_URL).origin &&
        !/^\/auth\/callback\//.test(path) &&
        !(path === "/auth/stripe/webhook" && request.method === "POST")
      )
        throw new ServiceError(
          403,
          "CSRF_ORIGIN",
          "Send this request from the configured site.",
        );
    }
  });
  registerRequestDecompression(app);
  app.setErrorHandler(async (error, request, reply) => {
    const status = statusSchema.safeParse(error);
    let failure =
      error instanceof ServiceError
        ? error
        : hasZodFastifySchemaValidationErrors(error) ||
            error instanceof z.ZodError
          ? new ServiceError(
              400,
              "INVALID_INPUT",
              "The request does not match its schema.",
            )
          : new ServiceError(
              status.success ? (status.data.statusCode ?? 500) : 500,
              "REQUEST_FAILED",
              status.success && (status.data.statusCode ?? 500) < 500
                ? "The request could not be processed."
                : "The request could not be completed.",
            );
    const path = nativePath(request);
    // Every failure in the protected, MCP and native auth namespaces is audited.
    if (
      protectedRequest(request, path) ||
      path === "/mcp" ||
      path.startsWith("/auth/")
    ) {
      try {
        await auditFailure(
          services.audit,
          requestContext(request),
          {
            action: "request.failure",
            detail: { method: request.method, path },
          },
          failure,
        );
      } catch (audited) {
        if (audited instanceof ServiceError) failure = audited;
        else {
          request.log.error("Failed to persist operation audit");
          failure = auditUnavailableError();
        }
      }
    }
    if (
      failure.statusCode === 429 &&
      typeof failure.detail === "object" &&
      failure.detail !== null &&
      "retry_after" in failure.detail &&
      typeof failure.detail.retry_after === "number"
    )
      reply.header("Retry-After", String(failure.detail.retry_after));
    return reply.code(failure.statusCode).send(
      errorSchema.parse({
        code: failure.code,
        message: failure.message,
        ...(failure.detail === null ? {} : { detail: failure.detail }),
        ...(typeof failure.detail === "object" &&
        failure.detail !== null &&
        "position" in failure.detail
          ? { position: failure.detail.position }
          : {}),
      }),
    );
  });
  registerPublicApiRoutes(app, services);
  registerApiRoutes(app, services, {
    embeddings: Boolean(services.similar),
    saas: env.saas,
    domainEnrollment: domainEnrollmentEnabled(env.auth),
  });
  registerAuthRoutes(app, services.auth, env.PUBLIC_URL);
  registerMcpRoutes(app, new McpService(services), limit);
  if (options.static !== false)
    await registerStaticRoutes(app, {
      publicUrl: env.PUBLIC_URL,
      billingConfig: services.billing.publicConfig(),
      dashboardDirectory:
        options.dashboardDirectory ??
        fileURLToPath(new URL("../../dashboard/dist", import.meta.url)),
      artifactDirectory:
        options.artifactDirectory ??
        fileURLToPath(new URL("../public", import.meta.url)),
    });
  return app;
}
