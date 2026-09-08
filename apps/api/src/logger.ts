import type { DestinationStream, LoggerOptions } from "pino";

export function loggerOptions(
  level: string,
  stream?: DestinationStream,
): LoggerOptions & { stream?: DestinationStream } {
  return {
    level,
    ...(stream ? { stream } : {}),
    redact: {
      paths: [
        "body",
        "req.body",
        "records[*].line",
        "req.headers.authorization",
        "req.headers.cookie",
        'req.headers["x-api-key"]',
      ],
      remove: true,
    },
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
