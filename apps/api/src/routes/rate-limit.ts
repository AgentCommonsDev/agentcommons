import type { FastifyInstance, FastifyRequest } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { ServiceError } from "../services/context.js";
import { requestContext } from "./context.js";
type RateCategory = "ingest" | "read" | "sql" | "mcp" | "auth";
export async function createRateLimiter(app: FastifyInstance) {
  await app.register(rateLimit, { global: false });
  const maxima: Record<RateCategory, number> = {
    ingest: 600,
    read: 300,
    sql: 60,
    mcp: 120,
    auth: 20,
  };
  const create = (category: RateCategory) =>
    app.createRateLimit({
      max: maxima[category],
      timeWindow: 60_000,
      keyGenerator: (request) => {
        const caller = requestContext(request).caller;
        return category === "auth"
          ? `${category}:${request.ip}`
          : `${category}:${caller?.organizationId ?? "anonymous"}:${caller?.apiKeyId ?? caller?.userId ?? request.ip}`;
      },
    });
  const limits = {
    ingest: create("ingest"),
    read: create("read"),
    sql: create("sql"),
    mcp: create("mcp"),
    auth: create("auth"),
  };
  return async (
    request: FastifyRequest,
    category: RateCategory,
  ): Promise<void> => {
    const result = await limits[category](request);
    if (!result.isAllowed && result.isExceeded)
      throw new ServiceError(
        429,
        "RATE_LIMITED",
        "Wait before making another request.",
        { retry_after: result.ttlInSeconds },
      );
  };
}
