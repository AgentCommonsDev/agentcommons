import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AuthService } from "../services/auth.js";
import { requestContext, requestHeaders } from "./context.js";

export function registerAuthRoutes(
  app: FastifyInstance,
  auth: AuthService,
  publicUrl: string,
): void {
  const forward = async (request: FastifyRequest, reply: FastifyReply) => {
    const headers = requestHeaders(request);
    headers.delete("content-length");
    headers.delete("content-encoding");
    const body =
      request.method === "GET" || request.body === undefined
        ? undefined
        : Buffer.isBuffer(request.body)
          ? Uint8Array.from(request.body)
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
    response.headers.forEach((value, name) => {
      if (name !== "set-cookie") reply.header(name, value);
    });
    const cookies = response.headers.getSetCookie();
    if (cookies.length) reply.header("set-cookie", cookies);
    return reply.send(Buffer.from(await response.arrayBuffer()));
  };
  app.register((webhook, _options, done) => {
    webhook.removeContentTypeParser("application/json");
    webhook.addContentTypeParser(
      "application/json",
      { parseAs: "buffer" },
      (_request, body, parsed) => {
        parsed(null, body);
      },
    );
    webhook.post("/auth/stripe/webhook", { schema: { hide: true } }, forward);
    done();
  });
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
    handler: forward,
  });
}
