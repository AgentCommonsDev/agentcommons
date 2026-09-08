import type { CallerContext } from "@agentcommons/core";
import type { Prisma, PrismaClient } from "@agentcommons/db";
import {
  auditFailure,
  type AuditDescription,
  type AuditService,
} from "./audit.js";
import {
  requirePermission,
  type ServiceContext,
  type ServiceResult,
} from "./context.js";

export async function mutationOperation<T>(
  dependencies: { prisma: PrismaClient; audit: AuditService },
  context: ServiceContext,
  permission: "ingest" | "admin",
  description: AuditDescription,
  execute: (
    tx: Prisma.TransactionClient,
    caller: CallerContext,
  ) => Promise<{ result: T; detail?: unknown; resourceIds?: string[] }>,
): Promise<ServiceResult<T>> {
  try {
    const caller = requirePermission(context, permission);
    return await dependencies.prisma.$transaction(
      async (tx) => {
        const value = await execute(tx, caller);
        const audit = await dependencies.audit.write(
          context,
          {
            ...description,
            ...(value.detail === undefined ? {} : { detail: value.detail }),
            ...(value.resourceIds ? { resourceIds: value.resourceIds } : {}),
          },
          tx,
        );
        return { result: value.result, audit };
      },
      { timeout: 120_000, maxWait: 30_000 },
    );
  } catch (error) {
    return auditFailure(dependencies.audit, context, description, error);
  }
}
