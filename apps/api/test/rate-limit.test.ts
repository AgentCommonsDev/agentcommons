import Fastify from "fastify";
import { expect, it } from "vitest";
import { callerContextSchema } from "@agentcommons/core";
import { z } from "zod";
import { createRateLimiter } from "../src/routes/rate-limit.js";
import { setRequestContext } from "../src/routes/context.js";
import { ServiceError } from "../src/services/context.js";

// @req R-SEC-06
it("enforces native per-minute quotas per installation, per client program for handshakes and per address for authentication", async () => {
  const app = Fastify();
  const limit = await createRateLimiter(app);
  app.setErrorHandler((error, _request, reply) =>
    reply
      .code(error instanceof ServiceError ? error.statusCode : 500)
      .send({ code: "limited" }),
  );
  app.post("/:category", async (request, reply) => {
    const category = z
      .enum(["ingest", "read", "sql", "mcp", "handshake", "auth"])
      .parse(z.object({ category: z.string() }).parse(request.params).category);
    const caller = callerContextSchema.parse({
      organizationId: request.headers["x-org"] ?? "organization",
      userId: "user",
      apiKeyId: request.headers["x-key"] ?? "key",
      role: "member",
      permissions: { sessions: ["read", "ingest"] },
      authMethod: "key",
    });
    setRequestContext(request, {
      caller,
      requestId: request.id,
      transport: "rest",
      ip: request.ip,
      userAgent: request.headers["user-agent"] ?? null,
      startedAt: Date.now(),
      headers: new Headers(),
    });
    await limit(request, category);
    return reply.code(204).send();
  });
  const post = (
    category: string,
    headers: Record<string, string> = {},
    remoteAddress?: string,
  ) =>
    app.inject({
      method: "POST",
      url: `/${category}`,
      headers: { "user-agent": "harness-a/1.0", ...headers },
      ...(remoteAddress ? { remoteAddress } : {}),
    });
  try {
    for (const [category, maximum] of Object.entries({
      ingest: 600,
      read: 300,
      sql: 60,
      mcp: 120,
      handshake: 600,
      auth: 20,
    })) {
      for (let count = 0; count < maximum; count++)
        expect((await post(category)).statusCode).toBe(204);
      expect((await post(category)).statusCode).toBe(429);
      // Another client program on the same key has its own budget for handshakes only;
      // every other category is the installation's (or the address's) shared budget.
      expect(
        (await post(category, { "user-agent": "harness-b/1.0" })).statusCode,
      ).toBe(category === "handshake" ? 204 : 429);
      if (category === "auth") {
        expect((await post("auth", { "x-key": "other" })).statusCode).toBe(429);
        expect((await post("auth", {}, "192.0.2.2")).statusCode).toBe(204);
      } else {
        expect((await post(category, { "x-key": "other" })).statusCode).toBe(
          204,
        );
        expect((await post(category, { "x-org": "other" })).statusCode).toBe(
          204,
        );
      }
    }
  } finally {
    await app.close();
  }
});
