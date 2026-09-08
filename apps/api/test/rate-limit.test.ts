import Fastify from "fastify";
import { expect, it } from "vitest";
import { callerContextSchema } from "@agentcommons/core";
import { z } from "zod";
import { createRateLimiter } from "../src/routes/rate-limit.js";
import { setRequestContext } from "../src/routes/context.js";
import { ServiceError } from "../src/services/context.js";

// @req R-SEC-06
it("enforces native per-minute category quotas and isolates organizations, keys and authentication IPs", async () => {
  const app = Fastify();
  const limit = await createRateLimiter(app);
  app.setErrorHandler((error, _request, reply) =>
    reply
      .code(error instanceof ServiceError ? error.statusCode : 500)
      .send({ code: "limited" }),
  );
  app.post("/:category", async (request, reply) => {
    const category = z
      .enum(["ingest", "read", "sql", "mcp", "auth"])
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
      userAgent: null,
      startedAt: Date.now(),
      headers: new Headers(),
    });
    await limit(request, category);
    return reply.code(204).send();
  });
  try {
    for (const [category, maximum] of Object.entries({
      ingest: 600,
      read: 300,
      sql: 60,
      mcp: 120,
      auth: 20,
    })) {
      for (let count = 0; count < maximum; count++)
        expect(
          (await app.inject({ method: "POST", url: `/${category}` }))
            .statusCode,
        ).toBe(204);
      expect(
        (await app.inject({ method: "POST", url: `/${category}` })).statusCode,
      ).toBe(429);
      if (category === "auth") {
        expect(
          (
            await app.inject({
              method: "POST",
              url: "/auth",
              headers: { "x-key": "other" },
            })
          ).statusCode,
        ).toBe(429);
        expect(
          (
            await app.inject({
              method: "POST",
              url: "/auth",
              remoteAddress: "192.0.2.2",
            })
          ).statusCode,
        ).toBe(204);
      } else {
        expect(
          (
            await app.inject({
              method: "POST",
              url: `/${category}`,
              headers: { "x-key": "other" },
            })
          ).statusCode,
        ).toBe(204);
        expect(
          (
            await app.inject({
              method: "POST",
              url: `/${category}`,
              headers: { "x-org": "other" },
            })
          ).statusCode,
        ).toBe(204);
      }
    }
  } finally {
    await app.close();
  }
});
