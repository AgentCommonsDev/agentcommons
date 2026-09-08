import type { Prisma } from "@agentcommons/db";
import { v7 as uuidv7 } from "uuid";
import type { BillingUsage } from "@agentcommons/core";
import { ServiceError } from "../services/context.js";

export interface BillingConfiguration {
  mode: "customer" | "public" | "saas";
  freeMonthlyRecords: number;
  proIncludedRecords: number;
  captureCentsPer1000: number | null;
  embeddingCentsPer1000: number | null;
  captureEventName: string | null;
  embeddingEventName: string | null;
  calComUrl: string | null;
}
function month(at: Date) {
  return {
    start: new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1)),
    end: new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1)),
  };
}
/** Native subscription state is the sole paid entitlement; never a browser return. */
export function activeSubscription(
  tx: Prisma.TransactionClient,
  organizationId: string,
  at = new Date(),
) {
  return tx.subscription.findFirst({
    where: {
      referenceId: organizationId,
      plan: { in: ["pro", "pro_embeddings"] },
      status: "active",
      stripeSubscriptionId: { not: null },
      periodStart: { lte: at },
      periodEnd: { gt: at },
    },
    orderBy: [{ periodEnd: "desc" }, { id: "asc" }],
  });
}
async function billingPeriod(
  tx: Prisma.TransactionClient,
  configuration: BillingConfiguration,
  organizationId: string,
  at: Date,
) {
  const paid =
    configuration.mode === "saas"
      ? await activeSubscription(tx, organizationId, at)
      : null;
  const calendar = month(at);
  return {
    paid,
    start: paid?.periodStart ?? calendar.start,
    end: paid?.periodEnd ?? calendar.end,
    plan:
      configuration.mode !== "saas"
        ? ("unmetered" as const)
        : paid?.plan === "pro_embeddings"
          ? ("pro_embeddings" as const)
          : paid
            ? ("pro" as const)
            : ("free" as const),
  };
}
/** Caller holds the organization lock so usage and admission cannot race. */
export async function billingUsage(
  tx: Prisma.TransactionClient,
  configuration: BillingConfiguration,
  organizationId: string,
  at: Date,
): Promise<
  Omit<
    BillingUsage,
    "can_manage" | "checkout_enabled" | "portal_enabled" | "cal_com_url"
  >
> {
  const period = await billingPeriod(tx, configuration, organizationId, at);
  const where = {
    organizationId,
    subscriptionId: period.paid?.id ?? null,
    periodStart: period.start,
  };
  const records = await tx.usageAdmission.count({
    where: { ...where, kind: "capture" },
  });
  const messages = await tx.usageAdmission.count({
    where: { ...where, kind: "embedding" },
  });
  const included =
    period.plan === "unmetered"
      ? null
      : period.plan === "free"
        ? configuration.freeMonthlyRecords
        : configuration.proIncludedRecords;
  const overage =
    period.paid && included !== null ? Math.max(0, records - included) : 0;
  const pending = await tx.billingMeterEvent.count({
    where: { organizationId, state: "pending" },
  });
  const reconciliation = await tx.billingMeterEvent.count({
    where: { organizationId, state: "reconciliation_required" },
  });
  return {
    plan: period.plan,
    period_start: period.start.toISOString(),
    period_end: period.end.toISOString(),
    records_used: records,
    included_records: included,
    remaining: included === null ? null : Math.max(0, included - records),
    overage_records: overage,
    embedding_messages_used: messages,
    estimated_capture_usd:
      configuration.captureCentsPer1000 === null
        ? null
        : (overage * configuration.captureCentsPer1000) / 100_000,
    estimated_embedding_usd:
      configuration.embeddingCentsPer1000 === null
        ? null
        : (messages * configuration.embeddingCentsPer1000) / 100_000,
    metering_pending: pending,
    metering_reconciliation_required: reconciliation,
  };
}

/** Persist successful canonical IDs, independent of purgeable transcript rows. */
export async function admitUsage(
  tx: Prisma.TransactionClient,
  configuration: BillingConfiguration,
  input: {
    organizationId: string;
    kind: "capture" | "embedding";
    resourceIds: readonly string[];
    receivedAt: Date;
  },
): Promise<void> {
  if (configuration.mode !== "saas" || input.resourceIds.length === 0) return;
  const period = await billingPeriod(
    tx,
    configuration,
    input.organizationId,
    input.receivedAt,
  );
  if (input.kind === "embedding" && period.plan !== "pro_embeddings")
    throw new ServiceError(
      402,
      "EMBEDDINGS_PLAN_REQUIRED",
      "Enable the paid embeddings option before indexing messages.",
    );
  const seen = await tx.usageAdmission.findMany({
    where: {
      organizationId: input.organizationId,
      kind: input.kind,
      resourceId: { in: [...input.resourceIds] },
    },
    select: { resourceId: true },
  });
  const seenIds = new Set(seen.map((row) => row.resourceId));
  const ids = [...new Set(input.resourceIds)].filter((id) => !seenIds.has(id));
  if (!ids.length) return;
  if (input.kind === "capture" && period.plan === "free") {
    const usage = await billingUsage(
      tx,
      configuration,
      input.organizationId,
      input.receivedAt,
    );
    if (usage.records_used + ids.length > configuration.freeMonthlyRecords)
      throw new ServiceError(
        402,
        "USAGE_LIMIT_REACHED",
        "This organization has reached its monthly record allowance. Upgrade or retry after the next UTC month begins.",
        {
          plan: usage.plan,
          included_records: usage.included_records,
          period_end: usage.period_end,
          cal_com_url: configuration.calComUrl,
        },
      );
  }
  await tx.usageAdmission.createMany({
    data: ids.map((resourceId) => ({
      organizationId: input.organizationId,
      kind: input.kind,
      resourceId,
      admittedAt: input.receivedAt,
      subscriptionId: period.paid?.id ?? null,
      periodStart: period.start,
      periodEnd: period.end,
    })),
  });
  if (!period.paid) return;
  const eventName =
    input.kind === "capture"
      ? configuration.captureEventName
      : configuration.embeddingEventName;
  const organization = await tx.organization.findUniqueOrThrow({
    where: { id: input.organizationId },
    select: { stripeCustomerId: true },
  });
  if (!eventName || !organization.stripeCustomerId)
    throw new ServiceError(
      503,
      "METERING_UNAVAILABLE",
      "Usage metering needs operator configuration. Retry this upload after configuration is restored.",
    );
  await tx.billingMeterEvent.create({
    data: {
      id: uuidv7(),
      organizationId: input.organizationId,
      subscriptionId: period.paid.id,
      customerId: organization.stripeCustomerId,
      kind: input.kind,
      eventName,
      quantity: ids.length,
      occurredAt: input.receivedAt,
    },
  });
}
