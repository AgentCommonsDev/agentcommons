import type { Harness, PrismaClient } from "../packages/db/src/index.js";
import { z } from "zod";

export const nativeCompletionSchema = z.strictObject({
  sessionId: z.string().min(1),
  sourcePos: z.number().int().nonnegative(),
  nativeEvent: z.string().min(1),
  activeLeafId: z.string().nullable(),
});

/** A prior shutdown during a fork is not the producer's final shutdown. */
export async function completedNativeSessions(
  prisma: PrismaClient,
  organizationId: string,
  harness: Harness,
  checkpoints: z.infer<typeof nativeCompletionSchema>[],
): Promise<boolean> {
  for (const checkpoint of checkpoints) {
    const session = await prisma.agentSession.findFirst({
      where: {
        organizationId,
        harness,
        harnessSessionId: checkpoint.sessionId,
        status: "ENDED",
        lifecyclePos: BigInt(checkpoint.sourcePos),
        batches: {
          some: {
            behavior: "end",
            lifecycleApplied: true,
            nativeEvent: checkpoint.nativeEvent,
            sourcePos: BigInt(checkpoint.sourcePos),
          },
        },
      },
      select: { projectedContext: true },
    });
    if (!session) return false;
    const projected = z
      .object({ activeLeafId: z.string().nullable().optional() })
      .parse(session.projectedContext);
    if (projected.activeLeafId !== checkpoint.activeLeafId) return false;
  }
  return true;
}
