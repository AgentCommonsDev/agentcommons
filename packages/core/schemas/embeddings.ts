import { z } from "zod";
import { reasonInputSchema } from "./admin.js";
import { nonnegativeIntegerSchema } from "./common.js";

export const organizationEmbeddingsInputSchema = reasonInputSchema.extend({
  enabled: z.boolean(),
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
export type OrganizationEmbeddings = z.infer<
  typeof organizationEmbeddingsOutputSchema
>;
