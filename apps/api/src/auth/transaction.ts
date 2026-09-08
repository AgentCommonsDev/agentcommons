import { Prisma, type PrismaClient } from "@agentcommons/db";
import { z } from "zod";

export async function membershipTransaction<T>(
  prisma: PrismaClient,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
  isolationLevel: Prisma.TransactionIsolationLevel = Prisma
    .TransactionIsolationLevel.Serializable,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel,
        timeout: 30_000,
      });
    } catch (error) {
      if (
        attempt >= 2 ||
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        !(
          ["P2034", "P2002"].includes(error.code) ||
          (error.code === "P2010" &&
            z.object({ code: z.enum(["40001", "40P01"]) }).safeParse(error.meta)
              .success)
        )
      )
        throw error;
    }
  }
}
