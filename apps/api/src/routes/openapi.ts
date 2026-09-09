import { z } from "zod";
import swagger from "@fastify/swagger";
import type { FastifyInstance, FastifySchema } from "fastify";
import * as schemas from "@agentcommons/core/schemas";
import {
  createJsonSchemaTransform,
  createJsonSchemaTransformObject,
  serializerCompiler,
} from "fastify-type-provider-zod";
import { queryValidatorCompiler } from "./query.js";

// `.describe()` texts live in zod's global registry; using it as the schema registry keeps
// every field meaning in the OpenAPI document, while only the schemas given an id here
// become named components.
const registry = z.globalRegistry;
for (const [schema, id] of [
  [schemas.jsonValueSchema, "JsonValue"],
  [schemas.dashboardChartSchema, "DashboardChart"],
  [schemas.dashboardTileSchema, "DashboardTile"],
  [schemas.dashboardVariableSchema, "DashboardVariable"],
  [schemas.dashboardDefinitionSchema, "DashboardDefinition"],
] as const)
  registry.add(schema, { ...registry.get(schema), id });
const openApiTransform: ReturnType<typeof createJsonSchemaTransform> =
  createJsonSchemaTransform({ schemaRegistry: registry });
const openApiTransformObject: ReturnType<
  typeof createJsonSchemaTransformObject
> = createJsonSchemaTransformObject({ schemaRegistry: registry });
const apiDefinition = (publicUrl?: string) => ({
  openapi: "3.1.0",
  info: { title: "AgentCommons API", version: "0.1.0" },
  ...(publicUrl ? { servers: [{ url: publicUrl }] } : {}),
  components: {
    securitySchemes: {
      bearerAuth: { type: "http" as const, scheme: "bearer" },
      cookieAuth: {
        type: "apiKey" as const,
        in: "cookie" as const,
        name: "better-auth.session_token",
      },
    },
  },
});

const responseSchema = z.custom<z.ZodType>(
  (value: unknown) => value instanceof z.ZodType,
);
const responseContract = z
  .record(
    z.string(),
    z.union([
      responseSchema,
      z.object({
        content: z
          .record(z.string(), z.object({ schema: responseSchema }))
          .refine((content) => Object.keys(content).length > 0),
      }),
    ]),
  )
  .refine((responses) => Object.keys(responses).length > 0);
/** Every application route under `/api` declares a summary and complete Zod schemas. */
export function assertRouteContract(route: {
  url: string;
  method: string | string[];
  schema?: FastifySchema;
}): void {
  if (route.url !== "/api" && !route.url.startsWith("/api/")) return;
  // This namespace belongs to the native Scalar reference plugin, including its assets.
  if (route.url === "/api/docs" || route.url.startsWith("/api/docs/")) return;
  const contract = route.schema;
  const methods = Array.isArray(route.method) ? route.method : [route.method];
  if (
    !contract?.summary?.trim() ||
    !responseContract.safeParse(contract.response).success ||
    !(contract.params instanceof z.ZodType) ||
    !(contract.querystring instanceof z.ZodType) ||
    (methods.some((method) => !["GET", "HEAD"].includes(method)) &&
      !(contract.body instanceof z.ZodType))
  )
    throw new Error(
      `Route ${methods.join(",")} ${route.url} must declare summary and complete Zod schemas.`,
    );
}

/** The validator, serializer, route-contract check and OpenAPI generator every instance shares. */
export async function registerContract(
  app: FastifyInstance,
  publicUrl?: string,
): Promise<void> {
  app.setValidatorCompiler(queryValidatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.addHook("onRoute", assertRouteContract);
  await app.register(swagger, {
    openapi: apiDefinition(publicUrl),
    transform: openApiTransform,
    transformObject: openApiTransformObject,
  });
}
