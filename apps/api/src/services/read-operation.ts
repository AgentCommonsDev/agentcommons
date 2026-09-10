import type { CallerContext } from "@agentcommons/core";
import type { PrismaClient } from "@agentcommons/db";
import type { TraceReaders } from "@agentcommons/traces";
import { traceReadFailure } from "../repositories/read-failure.js";
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
  readers: TraceReaders;
  audit: AuditService;
  cursors: CursorCodec;
  saas?: boolean;
}
interface ReadOptions<T> {
  /** Permission the caller must hold; reads default to `read`. */
  permission?: "read" | "admin";
  /** Structural summary of the result recorded in the audit detail. */
  describeResult?: (result: T) => unknown;
  /** Resource ids the audit row should reference. */
  describeResources?: (result: T) => readonly string[];
}
export async function readOperation<T>(
  audit: AuditService,
  context: ServiceContext,
  description: AuditDescription,
  execute: (caller: CallerContext) => Promise<T>,
  options: ReadOptions<T> = {},
): Promise<ServiceResult<T>> {
  try {
    const result = await execute(
      requirePermission(context, options.permission ?? "read"),
    );
    return {
      result,
      audit: await audit.write(context, {
        ...description,
        ...(options.describeResources
          ? { resourceIds: options.describeResources(result) }
          : {}),
        detail: {
          input: description.detail ?? null,
          result: options.describeResult?.(result) ?? null,
        },
      }),
    };
  } catch (error) {
    // Known trace-read limits and busy databases get their stable retryable codes (§7.4,
    // §7.5); anything else stays an unexpected OPERATION_FAILED with its logged cause.
    return auditFailure(
      audit,
      context,
      description,
      traceReadFailure(error) ?? error,
    );
  }
}
