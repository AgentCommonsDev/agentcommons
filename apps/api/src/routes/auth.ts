import type { FastifyInstance } from "fastify";
import type { AuthService } from "../services/auth.js";
import { requestContext, requestHeaders } from "./context.js";

export function registerAuthRoutes(
  app: FastifyInstance,
  auth: AuthService,
  publicUrl: string,
): void {
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (_request, body, done) => {
      done(null, body);
    },
  );
  app.route({
    method: ["GET", "POST"],
    url: "/auth/*",
    schema: { hide: true },
    handler: async (request, reply) => {
      const headers = requestHeaders(request);
      headers.delete("content-length");
      headers.delete("content-encoding");
      const body =
        request.method === "GET" || request.body === undefined
          ? undefined
          : typeof request.body === "string"
            ? request.body
            : JSON.stringify(request.body);
      const native = new Request(new URL(request.url, publicUrl), {
        method: request.method,
        headers,
        ...(body === undefined ? {} : { body }),
      });
      const response = (await auth.handle(native, requestContext(request)))
        .result;
      reply.status(response.status);
      for (const [name, value] of response.headers)
        if (name !== "set-cookie") reply.header(name, value);
      const cookies = response.headers.getSetCookie();
      if (cookies.length) reply.header("set-cookie", cookies);
      return reply.send(Buffer.from(await response.arrayBuffer()));
    },
  });
}
