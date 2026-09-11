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

/**
 * Whose budget a request spends and whose audit rows fold (§8.1, §9.4, ADR 0073). `address`
 * is the network peer, for requests before any credential is known. `caller` is one
 * installation: the organization and its key (a signed-in user, or the address before
 * either is known). `client` is one program on that installation: the caller and its
 * `User-Agent`, so two harnesses sharing a key are told apart and one cannot spend the
 * other's budget.
 */
const callerIdentity = (context: ServiceContext): string[] => [
  context.caller?.organizationId ?? "anonymous",
  context.caller?.apiKeyId ?? context.caller?.userId ?? context.ip ?? "",
];
export const identities = {
  address: (context: ServiceContext): string[] => [context.ip ?? ""],
  caller: callerIdentity,
  client: (context: ServiceContext): string[] => [
    ...callerIdentity(context),
    context.userAgent ?? "",
  ],
} as const;
export type Identity = keyof typeof identities;

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
