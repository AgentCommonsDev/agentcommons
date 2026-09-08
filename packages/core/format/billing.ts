import type { BillingConfig } from "../schemas/billing.js";

// Public pages use the declared English locale on both server and client.
const count = new Intl.NumberFormat("en-US");
const price = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});
export function formatPlans(config: BillingConfig) {
  return {
    freeAllowance: count.format(config.plans.free.monthly_records),
    proAllowance: count.format(config.plans.pro.included_records),
    embeddingPrice: price.format(config.plans.embeddings.monthly_price_usd),
    captureRate:
      config.plans.pro.capture_usd_per_1000 === null
        ? null
        : price.format(config.plans.pro.capture_usd_per_1000),
    embeddingRate:
      config.plans.embeddings.messages_usd_per_1000 === null
        ? null
        : price.format(config.plans.embeddings.messages_usd_per_1000),
    proPrice: price.format(config.plans.pro.monthly_price_usd),
  };
}
const periodDate = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});
export function formatBillingDate(value: string): string {
  return periodDate.format(new Date(value));
}
