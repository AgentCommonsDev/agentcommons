import type { Prisma } from "@agentcommons/db";

/** Shared native reset-token invalidation after account establishment or removal. */
export async function invalidateSetupTokens(
  db: Prisma.TransactionClient,
  userId: string,
) {
  await db.verification.deleteMany({
    where: { value: userId, identifier: { startsWith: "reset-password:" } },
  });
}
