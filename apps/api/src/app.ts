import type { DestinationStream } from "pino";
import { loggerOptions } from "./logger.js";
import Fastify, {
  type FastifyInstance,
  type FastifyRequest,
  type FastifySchema,
} from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import compress from "@fastify/compress";
import swagger from "@fastify/swagger";
import { registerApiReference } from "./routes/reference.js";
import {
  serializerCompiler,
  hasZodFastifySchemaValidationErrors,
} from "fastify-type-provider-zod";
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
import {
  apiDefinition,
  openApiTransform,
  openApiTransformObject,
} from "./routes/openapi.js";
import { queryValidatorCompiler } from "./routes/query.js";
import {
  registerRequestDecompression,
  INFLATED_LIMIT,
} from "./routes/compression.js";
import { createRateLimiter } from "./routes/rate-limit.js";
import { registerPublicApiRoutes } from "./routes/public.js";
import { registerApiRoutes } from "./routes/api.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerStaticRoutes } from "./routes/static.js";
import { McpService } from "./services/mcp.js";
import { registerMcpRoutes } from "./mcp/index.js";
import { auditFailure } from "./services/audit.js";
import { ServiceError } from "./services/context.js";

export function assertRouteContract(route: {
  url: string;
  method: string | string[];
  schema?: FastifySchema;
}): void {
  if (route.url !== "/api" && !route.url.startsWith("/api/")) return;
  // This namespace belongs to the native Scalar reference plugin, including its assets.
  if (route.url === "/api/docs" || route.url.startsWith("/api/docs/")) return;
  const contract = route.schema;
  const methods = Array.isArray(route.method) ? route.method : [route.method];
  if (
    !contract?.summary?.trim() ||
    !responseContract.safeParse(contract.response).success ||
    !(contract.params instanceof z.ZodType) ||
    !(contract.querystring instanceof z.ZodType) ||
    (methods.some((method) => !["GET", "HEAD"].includes(method)) &&
      !(contract.body instanceof z.ZodType))
  )
    throw new Error(
      `Route ${methods.join(",")} ${route.url} must declare summary and complete Zod schemas.`,
    );
}
const responseSchema = z.custom<z.ZodType>(
  (value: unknown) => value instanceof z.ZodType,
);
const responseContract = z
  .record(
    z.string(),
    z.union([
      responseSchema,
      z.object({
        content: z
          .record(z.string(), z.object({ schema: responseSchema }))
          .refine((content) => Object.keys(content).length > 0),
      }),
    ]),
  )
  .refine((responses) => Object.keys(responses).length > 0);
function protectedPath(path: string): boolean {
  return (
    path.startsWith("/api/v1/") &&
    !["/api/v1/health", "/api/v1/ready", "/api/v1/billing/config"].includes(
      path,
    )
  );
}
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
  app.setValidatorCompiler(queryValidatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.addHook("onRoute", assertRouteContract);
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: env.PUBLIC_URL,
    credentials: true,
    exposedHeaders: ["X-Next-Cursor", "Retry-After"],
  });
  await app.register(compress, {
    global: true,
    encodings: ["gzip", "deflate"],
    globalDecompression: false,
  });
  await app.register(swagger, {
    openapi: apiDefinition(env.PUBLIC_URL),
    transform: openApiTransform,
    transformObject: openApiTransformObject,
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
    if (
      env.INSTANCE_MODE === "customer" ||
      ![
        "/",
        "/docs",
        "/robots.txt",
        "/sitemap.xml",
        "/llms.txt",
        "/llms-full.txt",
      ].includes(path)
    )
      reply.header("X-Robots-Tag", "noindex, nofollow, noarchive");
    if (path.startsWith("/auth/")) await limit(request, "auth");
    if (path === "/mcp" && request.method !== "POST") return;
    if (protectedPath(path) || path === "/mcp") {
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
      setRequestContext(request, { ...context, caller: identity.caller });
      await limit(
        request,
        path === "/mcp"
          ? "mcp"
          : path.endsWith("/ingest")
            ? "ingest"
            : path.endsWith("/query")
              ? "sql"
              : "read",
      );
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
    const status = z
      .looseObject({ statusCode: z.number().optional() })
      .safeParse(error);
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
    if (protectedPath(path) || path === "/mcp" || path.startsWith("/auth/")) {
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
          failure = new ServiceError(
            503,
            "AUDIT_UNAVAILABLE",
            "The operation could not be recorded. Try again.",
          );
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
  registerApiRoutes(app, services);
  registerAuthRoutes(app, services.auth, env.PUBLIC_URL);
  registerMcpRoutes(app, new McpService(services), limit);
  if (options.static !== false)
    await registerStaticRoutes(app, {
      publicUrl: env.PUBLIC_URL,
      mode: env.INSTANCE_MODE,
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
