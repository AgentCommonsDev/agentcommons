import type { Prisma } from "@agentcommons/db";
import { activeSubscription } from "../repositories/billing.js";

/** Shared wanted state and authoritative native SaaS entitlement. */
export async function organizationEmbeddingSetting(
  tx: Prisma.TransactionClient,
  organizationId: string,
  lock = false,
  saas = false,
): Promise<{
  enabled: boolean;
  requested: boolean;
  entitled: boolean;
  revision: number;
}> {
  if (lock)
    await tx.$queryRaw`SELECT id FROM organization WHERE id=${organizationId} FOR SHARE`;
  const value = await tx.organizationSettings.findUnique({
    where: { organizationId },
  });
  const requested = value?.embeddingsEnabled ?? false;
  const entitled =
    !saas ||
    (await activeSubscription(tx, organizationId))?.plan === "pro_embeddings";
  return {
    enabled: requested && entitled,
    requested,
    entitled,
    revision: value?.revision ?? 0,
  };
}

/**
 * Whether vector capabilities work for one caller right now and, if not, which gate is
 * closed: the operator provider, the SaaS plan, or the organization's own setting.
 */
export interface EmbeddingAvailability {
  /** The operator configured a provider and the flag is on. */
  available: boolean;
  /** The organization stored the opt-in. */
  requested: boolean;
  /** The SaaS plan includes embeddings; always true outside SaaS. */
  entitled: boolean;
  /** All three gates open: `available && requested && entitled`. */
  enabled: boolean;
}
export const embeddingsUnavailable: EmbeddingAvailability = {
  available: false,
  requested: false,
  entitled: true,
  enabled: false,
};
/** Availability for one organization under the operator flag; reads the setting fresh each time. */
export async function embeddingAvailability(
  tx: Prisma.TransactionClient,
  organizationId: string,
  available: boolean,
  saas = false,
): Promise<EmbeddingAvailability> {
  if (!available) return embeddingsUnavailable;
  const setting = await organizationEmbeddingSetting(
    tx,
    organizationId,
    false,
    saas,
  );
  return {
    available,
    requested: setting.requested,
    entitled: setting.entitled,
    enabled: setting.enabled,
  };
}
/**
 * One sentence pair every adapter uses when a vector capability is asked for while
 * embeddings are off: what needs them, why they are off, and who can change that.
 */
export function embeddingsDisabledMessage(
  capability: string,
  state: EmbeddingAvailability,
): string {
  if (!state.available)
    return `${capability} needs embeddings, and this instance has no embedding provider configured. The instance operator has to configure one.`;
  if (!state.entitled)
    return `${capability} needs embeddings, which are part of the Pro with embeddings plan. An organization owner can change the plan under Billing.`;
  return `${capability} needs embeddings, which are turned off for this organization. An organization admin can turn them on under Settings.`;
}
