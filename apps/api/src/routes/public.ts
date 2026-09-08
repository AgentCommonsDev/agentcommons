import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  healthOutputSchema,
  authConfigOutputSchema,
  billingConfigSchema,
} from "@agentcommons/core/schemas";
import { requestContext } from "./context.js";
import type { Services } from "./services.js";
const empty = z.strictObject({});
export function registerPublicApiRoutes(
  app: FastifyInstance,
  services?: Services,
): void {
  const runtime = (): Services => {
    if (!services)
      throw new Error("This instance only generates the API contract.");
    return services;
  };
  for (const path of ["/health", "/api/v1/health"])
    app.get(
      path,
      {
        schema: {
          summary: "Check process health",
          params: empty,
          querystring: empty,
          response: { 200: healthOutputSchema },
        },
      },
      () => runtime().health.health(),
    );
  for (const path of ["/ready", "/api/v1/ready"])
    app.get(
      path,
      {
        schema: {
          summary: "Check database readiness",
          params: empty,
          querystring: empty,
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
      schema: {
        summary: "Read public plans and billing availability",
        params: empty,
        querystring: empty,
        response: { 200: billingConfigSchema },
      },
    },
    async (request) =>
      (await runtime().billing.configuration(requestContext(request))).result,
  );
  app.get(
    "/auth/config",
    {
      schema: {
        summary: "Read enabled login methods",
        params: empty,
        querystring: empty,
        response: { 200: authConfigOutputSchema },
      },
    },
    async (request) =>
      (await runtime().auth.configuration(requestContext(request))).result,
  );
}
