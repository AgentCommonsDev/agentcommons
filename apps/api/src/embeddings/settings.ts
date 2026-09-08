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
