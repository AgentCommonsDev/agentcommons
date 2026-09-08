import type { Prisma } from "@prisma/client";

/** One organization publication fence bounds native foreign-engine snapshots. */
export async function lockTracePublication(
  tx: Prisma.TransactionClient,
  organizationId: string,
  mode: "read" | "write",
): Promise<void> {
  const namespace = `trace-publication:${organizationId}`;
  if (mode === "read")
    await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended(${namespace}, 0))`;
  else
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${namespace}, 0))`;
}

/** Payload writes share this per-session fence; physical purge excludes every writer. */
export async function lockTraceSink(
  tx: Prisma.TransactionClient,
  organizationId: string,
  sessionId: string,
  mode: "read" | "write",
): Promise<void> {
  const namespace = `trace-sink:${organizationId}:${sessionId}`;
  if (mode === "read")
    await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended(${namespace},0))`;
  else
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${namespace},0))`;
}
