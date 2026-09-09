import type { FastifyInstance } from "fastify";
import { getRequestListener } from "@hono/node-server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  JSONRPCErrorResponseSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { errorSchema } from "@agentcommons/core/schemas";
import { serverInstructions, type McpService } from "../services/mcp.js";
import { ServiceError } from "../services/context.js";
import { requestContext } from "../routes/context.js";
import type { createRateLimiter } from "../routes/rate-limit.js";

function unavailable(): Response {
  return Response.json(
    errorSchema.parse({
      code: "AUDIT_UNAVAILABLE",
      message: "The operation could not be recorded. Try again.",
    }),
    { status: 503 },
  );
}

export function registerMcpRoutes(
  app: FastifyInstance,
  service: McpService,
  limit: Awaited<ReturnType<typeof createRateLimiter>>,
): void {
  app.route({
    method: ["GET", "DELETE"],
    url: "/mcp",
    handler: (_request, reply) => {
      reply.header("Allow", "POST");
      throw new ServiceError(405, "METHOD_NOT_ALLOWED", "Use POST for MCP.");
    },
  });
  app.post("/mcp", async (request, reply) => {
    const context = requestContext(request);
    const envelope = z
      .looseObject({ method: z.string(), params: z.unknown().optional() })
      .parse(request.body);
    let operationAudited = false;
    let auditUnavailable = false;
    const invoke = async <T>(operation: () => Promise<T>): Promise<T> => {
      try {
        const result = await operation();
        operationAudited = true;
        return result;
      } catch (error) {
        if (error instanceof ServiceError && error.audited)
          operationAudited = true;
        else auditUnavailable = true;
        throw error;
      }
    };
    const server = new McpServer(
      { name: "agentcommons", version: "0.1.0" },
      { capabilities: { tools: {} }, instructions: serverInstructions },
    );
    server.server.setRequestHandler(ListToolsRequestSchema, () =>
      invoke(async () => (await service.list(context)).result),
    );
    server.server.setRequestHandler(CallToolRequestSchema, (invocation) =>
      invoke(() =>
        service.call(
          context,
          invocation.params.name,
          invocation.params.arguments,
          () =>
            limit(request, invocation.params.name === "sql" ? "sql" : "read"),
        ),
      ),
    );
    const transport = new WebStandardStreamableHTTPServerTransport({
      enableJsonResponse: true,
    });
    // The official Node transport uses this same bridge. Keeping the SDK Response
    // here lets protocol rejections be audited before the bridge sends any bytes.
    await server.connect(transport);
    const listener = getRequestListener(
      async (nativeRequest) => {
        const response = await transport.handleRequest(nativeRequest, {
          parsedBody: request.body,
        });
        if (!operationAudited) {
          const protocol = response.headers
            .get("content-type")
            ?.includes("application/json")
            ? JSONRPCErrorResponseSchema.safeParse(
                await response
                  .clone()
                  .json()
                  .catch(() => null),
              )
            : null;
          const protocolError = protocol?.success ? protocol.data.error : null;
          await service.control(context, envelope.method, {
            statusCode: auditUnavailable
              ? 503
              : response.status >= 400
                ? response.status
                : protocolError
                  ? 400
                  : response.status,
            protocolError,
          });
        }
        return auditUnavailable ? unavailable() : response;
      },
      { overrideGlobalObjects: false, errorHandler: () => unavailable() },
    );
    for (const [name, value] of Object.entries(reply.getHeaders()))
      if (value !== undefined) reply.raw.setHeader(name, value);
    reply.hijack();
    try {
      await listener(request.raw, reply.raw);
    } finally {
      await transport.close();
      await server.close();
    }
  });
}
