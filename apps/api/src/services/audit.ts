import { createPolicyCache } from "./policy-cache.js";
import { Prisma, type PrismaClient, type AuditEvent } from "@agentcommons/db";
import {
  Redactor,
  omission,
  sanitizeRecord,
  type PolicyCache,
  type RedactionStructure,
} from "@agentcommons/core/redaction";
import { v7 as uuidv7 } from "uuid";
import { ServiceError, type ServiceContext } from "./context.js";
import { z } from "zod";
import { APIError } from "better-auth/api";
import { keyInstallation } from "../auth/installation.js";
import { wireValue } from "./read-budget.js";

export interface AuditActor {
  userId: string | null;
  apiKeyId: string | null;
  authMethod: string;
  organizationId?: string;
}

export interface AuditDescription {
  action: string;
  resourceType?: string;
  resourceIds?: readonly string[];
  statusCode?: number;
  detail?: unknown;
  actor?: AuditActor;
  /** Keys of `detail` that are protocol structure, kept verbatim by the redactor. */
  structure?: RedactionStructure;
}

/** Numeric service metadata is structural, like resourceIds, not persisted free text. */
const searchResultSchema = z.object({
  result: z.object({
    hits: z.number().int().nonnegative(),
    truncated_response: z.boolean(),
  }),
});
const queryInputSchema = z.object({ input: z.object({ query: z.string() }) });
const recordInputSchema = z.object({
  input: z.record(z.string(), z.json()),
});
/** Audit rows keep at most this much detail; larger ones retain an omission marker. */
const DETAIL_BYTES = 8192;

/** The 503 every adapter returns when an operation's audit row could not be written. */
export function auditUnavailableError(): ServiceError {
  return new ServiceError(
    503,
    "AUDIT_UNAVAILABLE",
    "The operation could not be recorded. Try again.",
  );
}

export class AuditService {
  private readonly fallback = new Redactor();
  constructor(
    private readonly prisma: PrismaClient,
    private readonly policies?: PolicyCache,
  ) {}

  private redactor(
    organizationId: string | null,
    tx: Prisma.TransactionClient,
  ) {
    if (!organizationId || !this.policies)
      return Promise.resolve(this.fallback);
    return (tx === this.prisma ? this.policies : createPolicyCache(tx)).get(
      organizationId,
    );
  }

  async redactText(
    context: ServiceContext,
    value: string,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<string> {
    const redactor = await this.redactor(
      context.caller?.organizationId ?? null,
      tx,
    );
    return (await redactor.text(value)).value;
  }

  async write(
    context: ServiceContext,
    operation: AuditDescription,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<AuditEvent> {
    const organizationId =
      context.caller?.organizationId ?? operation.actor?.organizationId ?? null;
    const redactor = await this.redactor(organizationId, tx);
    const source = wireValue(operation.detail ?? {});
    // Search rows keep their structural result and a bounded query preview even when the
    // full detail exceeds the budget.
    const readResult =
      operation.action === "search"
        ? searchResultSchema.safeParse(source)
        : null;
    const redacted = (await redactor.json(source, operation.structure)).value;
    const query = readResult?.success
      ? queryInputSchema.safeParse(redacted)
      : null;
    const queryPreview = query?.success
      ? sanitizeRecord({ query: query.data.input.query }, 2048)
      : null;
    const sanitized = sanitizeRecord(redacted, 6000);
    const sanitizedInput = recordInputSchema.safeParse(sanitized);
    const retained = readResult?.success
      ? {
          ...(sanitized !== null &&
          typeof sanitized === "object" &&
          !Array.isArray(sanitized)
            ? sanitized
            : {}),
          ...(queryPreview
            ? {
                input: sanitizedInput.success
                  ? sanitizedInput.data.input
                  : queryPreview,
              }
            : {}),
          result: readResult.data.result,
        }
      : sanitized;
    const detail =
      Buffer.byteLength(JSON.stringify(retained, null, 1)) <= DETAIL_BYTES
        ? retained
        : {
            omitted: omission(JSON.stringify(redacted)),
            ...(readResult?.success ? { result: readResult.data.result } : {}),
            ...(queryPreview ? { input: queryPreview } : {}),
          };
    const userAgent =
      context.userAgent === null
        ? null
        : (await redactor.text(context.userAgent)).value;
    const apiKeyId =
      context.caller?.apiKeyId ?? operation.actor?.apiKeyId ?? null;
    // Resolved at write time, inside the transaction: an ingest's own receipt attributes
    // its audit row to the installation it just created (R-AUD-04).
    const installation = await keyInstallation(tx, organizationId, apiKeyId);
    const data = {
      id: uuidv7(),
      organizationId,
      requestId: context.requestId,
      userId: context.caller?.userId ?? operation.actor?.userId ?? null,
      apiKeyId,
      installationId: installation?.id ?? null,
      authMethod:
        context.caller?.authMethod ?? operation.actor?.authMethod ?? "none",
      ip: context.ip ?? "unknown",
      userAgent,
      transport: context.transport,
      action: operation.action,
      resourceType: operation.resourceType ?? null,
      resourceIds: [...(operation.resourceIds ?? [])],
      statusCode: operation.statusCode ?? 200,
      durationMs: Math.max(0, Math.round(Date.now() - context.startedAt)),
      detail: detail === null ? Prisma.JsonNull : detail,
    };
    const persist = async (transaction: Prisma.TransactionClient) => {
      const row = await transaction.auditEvent.create({ data });
      if (organizationId)
        await transaction.traceAuditOutbox.create({
          data: { auditId: row.id },
        });
      return row;
    };
    return tx === this.prisma ? this.prisma.$transaction(persist) : persist(tx);
  }
}

/** Services call this after a failed transaction or read, before adapters respond. */
export async function auditFailure(
  audit: AuditService,
  context: ServiceContext,
  description: AuditDescription,
  error: unknown,
): Promise<never> {
  const failure =
    error instanceof ServiceError
      ? error
      : error instanceof z.ZodError
        ? new ServiceError(
            400,
            "INVALID_INPUT",
            error.issues.map((issue) => issue.message).join(" "),
          )
        : error instanceof APIError
          ? new ServiceError(
              error.statusCode,
              "AUTH_OPERATION_FAILED",
              error.message,
            )
          : new ServiceError(
              500,
              "OPERATION_FAILED",
              "The operation could not be completed.",
            );
  // The client sees the generic message; the adapter logs `cause` so operators can tell a
  // trace-database time limit from a lock timeout without request bodies ever being logged.
  if (failure !== error && failure.cause === undefined) failure.cause = error;
  if (!failure.audited) {
    await audit.write(context, {
      ...description,
      statusCode: failure.statusCode,
      detail: {
        input: description.detail ?? null,
        code: failure.code,
        message: failure.message,
      },
    });
    failure.audited = true;
  }
  throw failure;
}

export async function auditedOperation<T>(
  audit: AuditService,
  context: ServiceContext,
  description: AuditDescription,
  execute: () => Promise<T>,
): Promise<T> {
  try {
    return await execute();
  } catch (error) {
    return auditFailure(audit, context, description, error);
  }
}
