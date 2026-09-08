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
    const session = await prisma.traceSessionControl.findFirst({
      where: {
        organizationId,
        harness,
        harnessSessionId: checkpoint.sessionId,
        status: "ENDED",
        lifecyclePos: BigInt(checkpoint.sourcePos),
      },
      select: {
        id: true,
        projectedContext: true,
        acceptedRevision: true,
        publishedRevision: true,
      },
    });
    if (!session || session.acceptedRevision !== session.publishedRevision)
      return false;
    const receipt = await prisma.traceReceipt.findFirst({
      where: {
        organizationId,
        sessionId: session.id,
        behavior: "end",
        lifecycleApplied: true,
        nativeEvent: checkpoint.nativeEvent,
        sourcePos: BigInt(checkpoint.sourcePos),
        publishedAt: { not: null },
        revision: { lte: session.publishedRevision },
      },
      select: { id: true },
    });
    if (!receipt) return false;
    const projected = z
      .object({ activeLeafId: z.string().nullable().optional() })
      .parse(session.projectedContext);
    if (projected.activeLeafId !== checkpoint.activeLeafId) return false;
  }
  return true;
}
