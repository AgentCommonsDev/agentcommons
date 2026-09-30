import type { DestinationStream, LoggerOptions } from "pino";
import type { FastifyRequest } from "fastify";
import { ClickHouseError } from "@agentcommons/traces";
import type { ServiceError } from "./services/context.js";

/** Native SQL errors can include values even when they do not repeat the statement. */
function describeCause(cause: unknown) {
  if (cause instanceof ClickHouseError)
    return { name: cause.name, code: cause.code };
  const message = cause instanceof Error ? cause.message : String(cause);
  const cut = message.search(
    /\(query:|in scope |Stack trace|\bSELECT\b|\bWITH\b/i,
  );
  return {
    name: cause instanceof Error ? cause.name : typeof cause,
    message: (cut >= 0 ? message.slice(0, cut) : message).trim().slice(0, 300),
  };
}

/** Both adapters log server failures, including an MCP failure returned in HTTP 200. */
export function logRequestFailure(
  request: FastifyRequest,
  failure: ServiceError,
  cause: unknown = failure.cause ?? failure,
): void {
  if (failure.statusCode < 500) return;
  request.log.error(
    {
      requestId: request.id,
      method: request.method,
      path: new URL(request.url, "http://localhost").pathname,
      code: failure.code,
      cause: describeCause(cause),
    },
    "request failed",
  );
}

export function loggerOptions(
  level: string,
  stream?: DestinationStream,
): LoggerOptions & { stream?: DestinationStream } {
  return {
    level,
    ...(stream ? { stream } : {}),
    // The `req` serializer below is what keeps bodies and credentials out of request
    // logs; these paths are defense in depth for any application log that names them.
    redact: { paths: ["body", "records[*].line"], remove: true },
    serializers: {
      req: (request: { method: string; url: string; ip: string }) => ({
        method: request.method,
        url: (request.url.split("?")[0] ?? "/").replace(
          /^\/auth\/reset-password\/[^/]+$/,
          "/auth/reset-password/:token",
        ),
        remoteAddress: request.ip,
      }),
      res: (response: { statusCode: number }) => ({
        statusCode: response.statusCode,
      }),
    },
  };
}
