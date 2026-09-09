import type {
  CallerContext,
  JsonValue,
  transportSchema,
} from "@agentcommons/core";
import type { AuditEvent } from "@agentcommons/db";
import { hasAdminAuthority } from "@agentcommons/db";
import type { z } from "zod";
import type { AuthIdentity } from "../auth/identity.js";

export interface ServiceContext {
  caller: CallerContext | null;
  /** The authenticated user and session behind `caller`, set by adapter authentication. */
  principal?: AuthIdentity;
  requestId: string;
  transport: z.infer<typeof transportSchema>;
  ip: string | null;
  userAgent: string | null;
  startedAt: number;
  headers: Headers;
}

export interface ServiceResult<T> {
  result: T;
  audit: AuditEvent;
}

export class ServiceError extends Error {
  audited = false;
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly detail: JsonValue = null,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

export function requireCaller(context: ServiceContext): CallerContext {
  if (!context.caller)
    throw new ServiceError(
      403,
      "ORGANIZATION_REQUIRED",
      "Select an organization you belong to.",
    );
  return context.caller;
}

export function requirePermission(
  context: ServiceContext,
  permission: "read" | "ingest" | "admin",
): CallerContext {
  const caller = requireCaller(context);
  const allowed =
    permission === "admin"
      ? hasAdminAuthority(caller)
      : caller.authMethod === "cookie" ||
        caller.permissions.sessions?.includes(permission);
  if (!allowed)
    throw new ServiceError(
      403,
      "FORBIDDEN",
      "Your account or key does not have permission for this operation.",
    );
  return caller;
}
