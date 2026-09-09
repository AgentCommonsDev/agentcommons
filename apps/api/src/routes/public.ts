import type { FastifyInstance } from "fastify";
import {
  emptySchema,
  healthOutputSchema,
  authConfigOutputSchema,
  billingConfigSchema,
} from "@agentcommons/core/schemas";
import { requestContext } from "./context.js";
import { requireServices, type Services } from "./services.js";

/** Routes anyone may call: no authentication and no per-caller rate limit. */
const unprotected = { protected: false };
export function registerPublicApiRoutes(
  app: FastifyInstance,
  services?: Services,
): void {
  const runtime = (): Services => requireServices(services);
  for (const path of ["/health", "/api/v1/health"])
    app.get(
      path,
      {
        config: unprotected,
        schema: {
          summary: "Check process health",
          params: emptySchema,
          querystring: emptySchema,
          response: { 200: healthOutputSchema },
        },
      },
      () => runtime().health.health(),
    );
  for (const path of ["/ready", "/api/v1/ready"])
    app.get(
      path,
      {
        config: unprotected,
        schema: {
          summary: "Check database readiness",
          params: emptySchema,
          querystring: emptySchema,
          response: { 200: healthOutputSchema, 503: healthOutputSchema },
        },
      },
      async (_request, reply) => {
        const result = await runtime().health.ready();
        return reply.code(result.status === "ok" ? 200 : 503).send(result);
      },
    );
  app.get(
    "/api/v1/billing/config",
    {
      config: unprotected,
      schema: {
        summary: "Read public plans and billing availability",
        params: emptySchema,
        querystring: emptySchema,
        response: { 200: billingConfigSchema },
      },
    },
    async (request) =>
      (await runtime().billing.configuration(requestContext(request))).result,
  );
  app.get(
    "/auth/config",
    {
      config: unprotected,
      schema: {
        summary: "Read enabled login methods",
        params: emptySchema,
        querystring: emptySchema,
        response: { 200: authConfigOutputSchema },
      },
    },
    async (request) =>
      (await runtime().auth.configuration(requestContext(request))).result,
  );
}
