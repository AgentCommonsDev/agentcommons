import { z } from "zod";
import { enabledInputSchema } from "./admin.js";
import { nonnegativeIntegerSchema } from "./common.js";

export const organizationEmbeddingsInputSchema = enabledInputSchema;
/** Per-organization SSO-only (ADR 0093): the requested state and its dashboard version. */
export const organizationSsoInputSchema = z.strictObject({
  sso_only: z.boolean(),
});
export const organizationSsoOutputSchema = z.strictObject({
  sso_only: z.boolean(),
  revision: nonnegativeIntegerSchema,
});
export const organizationEmbeddingsOutputSchema = z.strictObject({
  enabled: z.boolean(),
  available: z.boolean(),
  entitled: z.boolean(),
  effective: z.boolean(),
  provider: z.enum(["openai", "fake"]).nullable(),
  model: z.string().nullable(),
  sessions_total: nonnegativeIntegerSchema,
  sessions_indexed: nonnegativeIntegerSchema,
  sessions_pending: nonnegativeIntegerSchema,
  last_attempt: z.enum(["completed", "failed", "reserved"]).nullable(),
});
