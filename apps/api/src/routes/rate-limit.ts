import type { FastifyInstance, FastifyRequest } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { ServiceError } from "../services/context.js";
import { requestContext } from "./context.js";

/** Requests per minute for each category; the category names are the table's keys. */
const maxima = { ingest: 600, read: 300, sql: 60, mcp: 120, auth: 20 } as const;
export type RateCategory = keyof typeof maxima;
const categories = Object.keys(maxima) as RateCategory[];

export async function createRateLimiter(app: FastifyInstance) {
  await app.register(rateLimit, { global: false });
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
  const limits = new Map(
    categories.map((category) => [category, create(category)] as const),
  );
  return async (
    request: FastifyRequest,
    category: RateCategory,
  ): Promise<void> => {
    const limit = limits.get(category);
    if (!limit) throw new Error(`Unknown rate category ${category}.`);
    const result = await limit(request);
    if (!result.isAllowed && result.isExceeded)
      throw new ServiceError(
        429,
        "RATE_LIMITED",
        "Wait before making another request.",
        { retry_after: result.ttlInSeconds },
      );
  };
}
