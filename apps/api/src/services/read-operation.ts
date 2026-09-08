import type { CallerContext } from "@agentcommons/core";
import type { PrismaClient, ReaderPools } from "@agentcommons/db";
import {
  auditFailure,
  type AuditDescription,
  type AuditService,
} from "./audit.js";
import type { CursorCodec } from "./cursor.js";
import {
  requirePermission,
  type ServiceContext,
  type ServiceResult,
} from "./context.js";

export interface ReadDependencies {
  prisma: PrismaClient;
  readers: ReaderPools;
  audit: AuditService;
  cursors: CursorCodec;
}
export async function readOperation<T>(
  audit: AuditService,
  context: ServiceContext,
  description: AuditDescription,
  execute: (caller: CallerContext) => Promise<T>,
  describeResult?: (result: T) => unknown,
  permission: "read" | "admin" = "read",
  describeResources?: (result: T) => readonly string[],
): Promise<ServiceResult<T>> {
  try {
    const result = await execute(requirePermission(context, permission));
    return {
      result,
      audit: await audit.write(context, {
        ...description,
        ...(describeResources
          ? { resourceIds: describeResources(result) }
          : {}),
        detail: {
          input: description.detail ?? null,
          result: describeResult?.(result) ?? null,
        },
      }),
    };
  } catch (error) {
    return auditFailure(audit, context, description, error);
  }
}
