import type { Prisma, Harness } from "@agentcommons/db";

/** Indexed native identity survives policy changes to the readable identifier. */
export async function nativeSession(
  tx: Prisma.TransactionClient,
  organizationId: string,
  harness: Harness,
  nativeId: string,
) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM agent_session WHERE organization_id=${organizationId}
      AND harness=${harness}::"Harness"
      AND public.native_identity(harness_session_id)=public.native_identity(${nativeId})`;
  const id = rows[0]?.id;
  return id
    ? tx.agentSession.findUniqueOrThrow({
        where: { organizationId_id: { organizationId, id } },
      })
    : null;
}

export async function waitingNativeChildren(
  tx: Prisma.TransactionClient,
  organizationId: string,
  harness: Harness,
  nativeId: string,
) {
  return tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM agent_session WHERE organization_id=${organizationId}
      AND harness=${harness}::"Harness" AND parent_session_id IS NULL
      AND public.native_identity(parent_native_ref)=public.native_identity(${nativeId})`;
}
