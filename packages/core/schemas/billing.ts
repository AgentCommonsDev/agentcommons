import { z } from "zod";
import { nonnegativeIntegerSchema, utcDateTimeSchema } from "./common.js";

export const instanceModeSchema = z.enum(["customer", "public", "saas"]);
export const paidPlanSchema = z.enum(["pro", "pro_embeddings"]);
export const billingCheckoutSchema = z.strictObject({ plan: paidPlanSchema });
export const calendarUrlSchema = z.url().refine((value) => {
  const url = new URL(value);
  return (
    url.protocol === "https:" &&
    ["cal.com", "www.cal.com"].includes(url.hostname) &&
    !url.username &&
    !url.password
  );
}, "Use an HTTPS Cal.com booking URL.");
export const billingConfigSchema = z.strictObject({
  mode: instanceModeSchema,
  enabled: z.boolean(),
  plans: z.strictObject({
    free: z.strictObject({ monthly_records: nonnegativeIntegerSchema }),
    pro: z.strictObject({
      included_records: nonnegativeIntegerSchema,
      monthly_price_usd: z.literal(100).default(100),
      capture_usd_per_1000: z.number().nonnegative().nullable(),
    }),
    embeddings: z.strictObject({
      monthly_price_usd: z.literal(50).default(50),
      messages_usd_per_1000: z.number().nonnegative().nullable(),
    }),
  }),
  checkout_enabled: z.boolean(),
  cal_com_url: calendarUrlSchema.nullable(),
});
export const billingUsageSchema = z.strictObject({
  plan: z.enum(["free", "pro", "pro_embeddings", "unmetered"]),
  period_start: utcDateTimeSchema,
  period_end: utcDateTimeSchema,
  records_used: nonnegativeIntegerSchema,
  included_records: nonnegativeIntegerSchema.nullable(),
  remaining: nonnegativeIntegerSchema.nullable(),
  overage_records: nonnegativeIntegerSchema,
  embedding_messages_used: nonnegativeIntegerSchema,
  estimated_capture_usd: z.number().nonnegative().nullable(),
  estimated_embedding_usd: z.number().nonnegative().nullable(),
  metering_pending: nonnegativeIntegerSchema,
  metering_reconciliation_required: nonnegativeIntegerSchema,
  can_manage: z.boolean(),
  checkout_enabled: z.boolean(),
  portal_enabled: z.boolean(),
  cal_com_url: calendarUrlSchema.nullable(),
});
export const billingRedirectSchema = z.strictObject({
  url: z
    .url()
    .refine((value) => {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        ["checkout.stripe.com", "billing.stripe.com"].includes(url.hostname)
      );
    }, "Billing redirects must use Stripe's secure checkout or portal.")
    .nullable(),
});
export type BillingConfig = z.infer<typeof billingConfigSchema>;
export type BillingUsage = z.infer<typeof billingUsageSchema>;
export type PaidPlan = z.infer<typeof paidPlanSchema>;
export const defaultBillingConfig: BillingConfig = billingConfigSchema.parse({
  mode: "customer",
  enabled: false,
  plans: {
    free: { monthly_records: 1000 },
    pro: { included_records: 10000, capture_usd_per_1000: null },
    embeddings: { messages_usd_per_1000: null },
  },
  checkout_enabled: false,
  cal_com_url: null,
});
