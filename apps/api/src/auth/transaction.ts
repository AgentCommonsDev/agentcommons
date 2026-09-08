import { Prisma, type PrismaClient } from "@agentcommons/db";

export async function membershipTransaction<T>(
  prisma: PrismaClient,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 30_000,
      });
    } catch (error) {
      if (
        attempt >= 2 ||
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        !["P2034", "P2002"].includes(error.code)
      )
        throw error;
    }
  }
}
