import { z } from "zod";
import * as schemas from "@agentcommons/core/schemas";
import {
  createJsonSchemaTransform,
  createJsonSchemaTransformObject,
} from "fastify-type-provider-zod";

const registry = z.registry<{ id: string }>();
registry.add(schemas.jsonValueSchema, { id: "JsonValue" });
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
