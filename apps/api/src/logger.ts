import type { DestinationStream, LoggerOptions } from "pino";

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
