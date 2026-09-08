import type { PrismaClient } from "@agentcommons/db";
import type { TraceRepository } from "@agentcommons/traces";
import { operatorContext } from "../auth/bootstrap.js";
import { auditedOperation, type AuditService } from "./audit.js";
import { createPolicyCache } from "./policy-cache.js";
import { jsonValueSchema } from "@agentcommons/core";

/** PostgreSQL owns audit history; this outbox maintains its bounded analytics projection. */
export class TraceAuditProjectionService {
  constructor(
    private readonly dependencies: {
      prisma: PrismaClient;
      audit: AuditService;
      traces: Pick<TraceRepository, "appendAudit">;
    },
  ) {}

  async flush(limit = 100): Promise<number> {
    const context = operatorContext();
    return auditedOperation(
      this.dependencies.audit,
      context,
      { action: "audit.projection" },
      () =>
        this.dependencies.prisma.$transaction(
          async (tx) => {
            // Locks keep concurrent publishers and retention from deleting an in-flight source.
            // A lost ClickHouse acknowledgement rolls back this checkpoint; identical audit IDs retry.
            const selected = await tx.$queryRaw<{ audit_id: string }[]>`
          SELECT audit_id FROM public.trace_audit_outbox
          ORDER BY created_at,audit_id
          LIMIT ${Math.min(100, Math.max(1, Math.trunc(limit)))} FOR UPDATE SKIP LOCKED`;
            if (!selected.length) return 0;
            const ids = selected.map((row) => row.audit_id);
            const rows = await tx.auditEvent.findMany({
              where: { id: { in: ids } },
            });
            const users = await tx.user.findMany({
              where: {
                id: {
                  in: [
                    ...new Set(
                      rows.flatMap((row) => (row.userId ? [row.userId] : [])),
                    ),
                  ],
                },
              },
              select: { id: true, email: true },
            });
            const emails = new Map(users.map((user) => [user.id, user.email]));
            const policies = createPolicyCache(tx);
            await this.dependencies.traces.appendAudit(
              await Promise.all(
                rows.map(async (row) => {
                  if (!row.organizationId)
                    throw new Error(
                      "An audit projection requires an organization.",
                    );
                  const email = row.userId ? emails.get(row.userId) : undefined;
                  const redactor = await policies.get(row.organizationId);
                  return {
                    id: row.id,
                    organization_id: row.organizationId,
                    ts: row.ts,
                    user_id: row.userId,
                    user_email: email
                      ? (await redactor.text(email)).value
                      : null,
                    api_key_id: row.apiKeyId,
                    installation_id: row.installationId,
                    auth_method: row.authMethod,
                    transport: row.transport,
                    action: row.action,
                    resource_ids: row.resourceIds,
                    status_code: row.statusCode,
                    duration_ms: row.durationMs,
                    detail: jsonValueSchema.parse(row.detail),
                  };
                }),
              ),
            );
            await tx.traceAuditOutbox.deleteMany({
              where: { auditId: { in: ids } },
            });
            await this.dependencies.audit.write(
              context,
              {
                action: "audit.projection",
                detail: { projected: rows.length },
              },
              tx,
            );
            return rows.length;
          },
          { timeout: 35000, maxWait: 10000 },
        ),
    );
  }
}
