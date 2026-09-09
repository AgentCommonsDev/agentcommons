import { z } from "zod";
import * as schemas from "@agentcommons/core/schemas";
import {
  createJsonSchemaTransform,
  createJsonSchemaTransformObject,
} from "fastify-type-provider-zod";

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
export const openApiTransform: ReturnType<typeof createJsonSchemaTransform> =
  createJsonSchemaTransform({ schemaRegistry: registry });
export const openApiTransformObject: ReturnType<
  typeof createJsonSchemaTransformObject
> = createJsonSchemaTransformObject({ schemaRegistry: registry });
export const apiDefinition = (publicUrl?: string) => ({
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
