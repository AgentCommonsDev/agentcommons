import type { Prisma, PrismaClient } from "@agentcommons/db";

/** Receipt time is server-owned; a shared key follows its latest accepted ingest. */
export async function keyInstallation(
  db: PrismaClient | Prisma.TransactionClient,
  organizationId: string | null | undefined,
  apiKeyId: string | null | undefined,
) {
  if (!organizationId || !apiKeyId) return null;
  const receipt = await db.traceReceipt.findFirst({
    where: { organizationId, apiKeyId },
    orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
    select: { installationId: true },
  });
  return receipt
    ? db.installation.findUnique({
        where: {
          organizationId_id: { organizationId, id: receipt.installationId },
        },
        select: { id: true, toolsEnabled: true },
      })
    : null;
}
