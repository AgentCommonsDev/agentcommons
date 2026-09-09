import { lockTracePublication, type Prisma } from "@agentcommons/db";
import { z } from "zod";
import type Stripe from "stripe";
import {
  defaultBillingConfig,
  type PaidPlan,
} from "@agentcommons/core/schemas/billing";
import { createAuth, type AuthConfiguration } from "./config.js";
import { lockOrganization, requireCookie } from "../services/auth.js";
import { ServiceError, type ServiceContext } from "../services/context.js";

async function billingOwner(
  tx: Prisma.TransactionClient,
  config: AuthConfiguration,
  context: ServiceContext,
) {
  const caller = requireCookie(context);
  if (caller.role !== "owner")
    throw new ServiceError(
      403,
      "OWNER_REQUIRED",
      "Only an organization owner can manage billing.",
    );
  await lockOrganization(tx, caller);
  if (config.instanceMode !== "saas" || !config.stripe)
    throw new ServiceError(
      503,
      "BILLING_UNAVAILABLE",
      "Online billing is not configured for this instance.",
    );
  return { caller, stripe: config.stripe };
}

export async function nativeCheckout(
  tx: Prisma.TransactionClient,
  config: AuthConfiguration,
  context: ServiceContext,
  plan: PaidPlan,
): Promise<{ url: string | null }> {
  const { caller, stripe } = await billingOwner(tx, config, context);
  const existing = await tx.subscription.findFirst({
    where: {
      referenceId: caller.organizationId,
      status: { in: ["active", "trialing"] },
    },
  });
  if (existing?.plan === plan)
    throw new ServiceError(
      409,
      "PLAN_UNCHANGED",
      "This organization already has the selected plan.",
    );
  const priceId = plan === "pro" ? stripe.priceId : stripe.embeddingsPriceId;
  const price = await stripe.client.prices.retrieve(priceId);
  const monthlyCents =
    (defaultBillingConfig.plans.pro.monthly_price_usd +
      (plan === "pro_embeddings"
        ? defaultBillingConfig.plans.embeddings.monthly_price_usd
        : 0)) *
    100;
  if (
    !monthly(price) ||
    price.unit_amount !== monthlyCents ||
    price.recurring?.usage_type !== "licensed"
  )
    throw priceMismatch();
  await validateMeter(stripe, "capture");
  if (plan === "pro_embeddings") await validateMeter(stripe, "embedding");
  const response = await createAuth(tx, config).api.upgradeSubscription({
    headers: context.headers,
    body: {
      plan,
      ...(existing?.stripeSubscriptionId
        ? { subscriptionId: existing.stripeSubscriptionId }
        : {}),
      customerType: "organization",
      referenceId: caller.organizationId,
      successUrl: `${config.publicUrl}/app/billing`,
      cancelUrl: `${config.publicUrl}/app/billing`,
      returnUrl: `${config.publicUrl}/app/billing`,
      disableRedirect: true,
    },
  });
  const result = z.object({ url: z.url() }).parse(response);
  await lockTracePublication(tx, caller.organizationId, "write");
  return {
    url: result.url === `${config.publicUrl}/app/billing` ? null : result.url,
  };
}

export async function nativeBillingPortal(
  tx: Prisma.TransactionClient,
  config: AuthConfiguration,
  context: ServiceContext,
): Promise<{ url: string }> {
  const { caller } = await billingOwner(tx, config, context);
  const response = await createAuth(tx, config).api.createBillingPortal({
    headers: context.headers,
    body: {
      customerType: "organization",
      referenceId: caller.organizationId,
      returnUrl: `${config.publicUrl}/app/billing`,
      disableRedirect: true,
    },
  });
  return z.object({ url: z.url() }).parse(response);
}

function priceMismatch() {
  return new ServiceError(
    503,
    "BILLING_PRICE_MISMATCH",
    "The configured billing prices or meters do not match the published plan.",
  );
}
function monthly(price: Stripe.Price) {
  return (
    price.active &&
    price.currency === "usd" &&
    price.type === "recurring" &&
    price.recurring?.interval === "month" &&
    price.recurring.interval_count === 1 &&
    !price.transform_quantity
  );
}
async function validateMeter(
  stripe: NonNullable<AuthConfiguration["stripe"]>,
  kind: "capture" | "embedding",
) {
  const priceId =
    kind === "capture" ? stripe.capturePriceId : stripe.embeddingUsagePriceId;
  const meterId =
    kind === "capture" ? stripe.captureMeterId : stripe.embeddingMeterId;
  const eventName =
    kind === "capture" ? stripe.captureEventName : stripe.embeddingEventName;
  const rate =
    (kind === "capture"
      ? stripe.captureCentsPer1000
      : stripe.embeddingCentsPer1000) / 1000;
  const price = await stripe.client.prices.retrieve(priceId, {
    expand: ["tiers"],
  });
  const meter = await stripe.client.billing.meters.retrieve(meterId);
  if (
    !monthly(price) ||
    price.recurring?.usage_type !== "metered" ||
    price.recurring.meter !== meterId ||
    meter.status !== "active" ||
    meter.event_name !== eventName ||
    meter.default_aggregation.formula !== "sum" ||
    !z.literal("by_id").safeParse(meter.customer_mapping.type).success ||
    meter.customer_mapping.event_payload_key !== "stripe_customer_id" ||
    meter.value_settings.event_payload_key !== "value" ||
    meter.event_time_window
  )
    throw priceMismatch();
  if (kind === "capture") {
    const [included, overage] = price.tiers ?? [];
    if (
      price.billing_scheme !== "tiered" ||
      price.tiers_mode !== "graduated" ||
      price.tiers?.length !== 2 ||
      included?.up_to !== stripe.includedRecords ||
      Number(included.unit_amount_decimal ?? included.unit_amount) !== 0 ||
      Number(included.flat_amount_decimal ?? included.flat_amount ?? 0) !== 0 ||
      !overage ||
      overage.up_to !== null ||
      Number(overage.unit_amount_decimal ?? overage.unit_amount) !== rate ||
      Number(overage.flat_amount_decimal ?? overage.flat_amount ?? 0) !== 0
    )
      throw priceMismatch();
  } else if (
    price.billing_scheme !== "per_unit" ||
    Number(price.unit_amount_decimal ?? price.unit_amount) !== rate
  )
    throw priceMismatch();
}
