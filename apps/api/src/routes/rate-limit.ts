import type { FastifyInstance, FastifyRequest } from "fastify";
import rateLimit from "@fastify/rate-limit";
import {
  identities,
  ServiceError,
  type Identity,
} from "../services/context.js";
import { requestContext } from "./context.js";

/**
 * Requests per minute for each category and whose budget it is (`identities`, §9.4). A
 * `caller` budget protects a shared resource from one installation; a `client` budget
 * belongs to one program on that installation, so the program that exhausts it is refused
 * alone; an `address` budget covers requests before a credential is known.
 */
const budgets = {
  ingest: { max: 600, identity: "caller" },
  read: { max: 300, identity: "caller" },
  sql: { max: 60, identity: "caller" },
  /** MCP `tools/call`: the installation's budget in front of the readers (§8.1). */
  mcp: { max: 120, identity: "caller" },
  /** MCP messages that invoke no tool, and protocol rejections (§8.1, ADR 0073). */
  handshake: { max: 600, identity: "client" },
  auth: { max: 20, identity: "address" },
} as const satisfies Record<string, { max: number; identity: Identity }>;
export type RateCategory = keyof typeof budgets;
const categories = Object.keys(budgets) as RateCategory[];

/**
 * `maxima` replaces a category's per-minute maximum. Deployments pass none; the browser
 * fixture raises `read`, because it drives every spec through one owner's budget.
 */
export async function createRateLimiter(
  app: FastifyInstance,
  maxima: Partial<Record<RateCategory, number>> = {},
) {
  await app.register(rateLimit, { global: false });
  const create = (category: RateCategory) => {
    const budget = budgets[category];
    return app.createRateLimit({
      max: maxima[category] ?? budget.max,
      timeWindow: 60_000,
      keyGenerator: (request) =>
        [
          category,
          ...identities[budget.identity](requestContext(request)),
        ].join("\u0000"),
    });
  };
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
