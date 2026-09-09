import type { Prisma } from "@prisma/client";

/** A transaction-scoped advisory lock on one namespace: shared for reads, exclusive for writes. */
async function advisoryXactLock(
  tx: Prisma.TransactionClient,
  namespace: string,
  mode: "read" | "write",
): Promise<void> {
  if (mode === "read")
    await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended(${namespace},0))`;
  else
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${namespace},0))`;
}

/** One organization publication fence bounds native foreign-engine snapshots. */
export function lockTracePublication(
  tx: Prisma.TransactionClient,
  organizationId: string,
  mode: "read" | "write",
): Promise<void> {
  return advisoryXactLock(tx, `trace-publication:${organizationId}`, mode);
}

/** Payload writes share this per-session fence; physical purge excludes every writer. */
export function lockTraceSink(
  tx: Prisma.TransactionClient,
  organizationId: string,
  sessionId: string,
  mode: "read" | "write",
): Promise<void> {
  return advisoryXactLock(
    tx,
    `trace-sink:${organizationId}:${sessionId}`,
    mode,
  );
}

/** Row lock on one session's control row for the rest of the transaction; false when the row is absent. */
export async function lockTraceSessionControl(
  tx: Prisma.TransactionClient,
  organizationId: string,
  sessionId: string,
): Promise<boolean> {
  const locked = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM trace_session_control WHERE organization_id=${organizationId} AND id=${sessionId}::uuid FOR UPDATE`;
  return locked.length > 0;
}
