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
import {
  messageRate,
  serverInstructions,
  type McpService,
} from "../services/mcp.js";
import { auditUnavailableError } from "../services/audit.js";
import { ServiceError } from "../services/context.js";
import { hijackRaw, requestContext } from "../routes/context.js";
import type { createRateLimiter } from "../routes/rate-limit.js";

const envelopeSchema = z.looseObject({
  method: z.string(),
  params: z.unknown().optional(),
});
function unavailable(): Response {
  const failure = auditUnavailableError();
  return Response.json(
    errorSchema.parse({ code: failure.code, message: failure.message }),
    { status: failure.statusCode },
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
      // A GET or DELETE on /mcp probes the optional standalone SSE stream and the session
      // teardown that this stateless transport does not offer; 405 is the compliant answer
      // (§8.1). It is a capability probe before any handshake, not a failed operation, so
      // it writes no audit row: the transport answers here rather than throwing into the
      // audited failure path in app.ts, the same class as a folded handshake (ADR 0073).
      reply.header("Allow", "POST");
      return reply.code(405).send(
        errorSchema.parse({
          code: "METHOD_NOT_ALLOWED",
          message: "Use POST for MCP.",
        }),
      );
    },
  });
  app.post(
    "/mcp",
    { config: { protected: true, rate: "message" } },
    async (request, reply) => {
      const context = requestContext(request);
      const parsed = envelopeSchema.safeParse(request.body);
      // Spent before the SDK sees the message: an operation from the installation's
      // budget, a handshake or rejection from the calling program's own (§8.1).
      await limit(
        request,
        messageRate(parsed.success ? parsed.data.method : undefined),
      );
      if (!parsed.success) throw parsed.error;
      const envelope = parsed.data;
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
            (rate) => limit(request, rate),
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
            const protocolError = protocol?.success
              ? protocol.data.error
              : null;
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
      hijackRaw(reply);
      try {
        await listener(request.raw, reply.raw);
      } finally {
        await transport.close();
        await server.close();
      }
    },
  );
}
