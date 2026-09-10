import type { PrismaClient, ReadAuthority } from "@agentcommons/db";
import {
  isAttributableRead,
  SESSION_READS_BACKFILL,
  type TraceAudit,
  type TraceReaders,
  type TraceRepository,
} from "@agentcommons/traces";
import { z } from "zod";
import { operatorContext } from "../auth/bootstrap.js";
import { auditedOperation, type AuditService } from "./audit.js";
import { createPolicyCache } from "./policy-cache.js";
import { jsonValueSchema } from "@agentcommons/core";

/** Audit rows one `flush` projects; a full batch tells the worker to flush again at once. */
export const AUDIT_PROJECTION_BATCH = 100;
/** Organizations one backfill page enumerates. */
const BACKFILL_PAGE = 100;
/** `api_ro.attributed_reads` as the worker copies it into `session_reads` (ADR 0060). */
const attributedReadSchema = z.object({
  audit_id: z.uuid(),
  session_id: z.uuid(),
  read_at: z.coerce.date(),
  action: z.string().min(1),
  target_session_id: z.uuid(),
  reader_user_id: z.string().nullable(),
  reader_email: z.string().nullable(),
  reader_harness: z.string().min(1),
});
const ATTRIBUTED_READS_SQL =
  "SELECT audit_id,session_id,read_at,action,target_session_id,reader_user_id,reader_email,reader_harness FROM api_ro.attributed_reads";

/**
 * The reader a background worker uses for one organization: admin authority so private
 * sessions are attributed too, under the literal user `worker`. Rows it derives are read
 * back under each caller's own principal, whose row policies re-apply visibility.
 */
function workerAuthority(organizationId: string): ReadAuthority {
  return {
    organizationId,
    userId: "worker",
    role: "owner",
    permissions: { sessions: ["read"], admin: ["*"] },
    authMethod: "key",
  };
}

/** PostgreSQL owns audit history; this outbox maintains its bounded analytics projection. */
export class TraceAuditProjectionService {
  constructor(
    private readonly dependencies: {
      prisma: PrismaClient;
      audit: AuditService;
      traces: Pick<
        TraceRepository,
        | "appendAudit"
        | "appendSessionReads"
        | "backfillCompleted"
        | "completeBackfill"
      >;
      readers: Pick<TraceReaders, "read">;
    },
  ) {}

  async flush(limit = AUDIT_PROJECTION_BATCH): Promise<number> {
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
          LIMIT ${limit} FOR UPDATE SKIP LOCKED`;
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
            const audits: TraceAudit[] = await Promise.all(
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
                  user_email: email ? (await redactor.text(email)).value : null,
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
            );
            await this.dependencies.traces.appendAudit(audits);
            // Attribution reads the rows just appended, so it follows the append and
            // precedes the checkpoint: a failed attribution retries the whole batch.
            const attributed = await this.attribute(audits);
            await tx.traceAuditOutbox.deleteMany({
              where: { auditId: { in: ids } },
            });
            await this.dependencies.audit.write(
              context,
              {
                action: "audit.projection",
                detail: { projected: rows.length, attributed },
              },
              tx,
            );
            return rows.length;
          },
          { timeout: 35000, maxWait: 10000 },
        ),
    );
  }

  /** Credits the batch's qualifying reads to active sessions, one reader query per organization. */
  private async attribute(audits: readonly TraceAudit[]): Promise<number> {
    const candidates = new Map<string, string[]>();
    for (const audit of audits)
      if (isAttributableRead(audit)) {
        const ids = candidates.get(audit.organization_id) ?? [];
        ids.push(audit.id);
        candidates.set(audit.organization_id, ids);
      }
    let attributed = 0;
    for (const [organizationId, ids] of candidates)
      attributed += await this.copyAttributedReads(organizationId, ids);
    return attributed;
  }

  /**
   * Copies `api_ro.attributed_reads` for one organization into `session_reads`: every row
   * when `auditIds` is null (backfill), else the rows of those audit events (flush).
   */
  private async copyAttributedReads(
    organizationId: string,
    auditIds: readonly string[] | null,
  ): Promise<number> {
    const reads = await this.dependencies.readers.read(
      workerAuthority(organizationId),
      async (client) =>
        z
          .array(attributedReadSchema)
          .parse(
            (
              await client.query(
                auditIds === null
                  ? ATTRIBUTED_READS_SQL
                  : `${ATTRIBUTED_READS_SQL} WHERE audit_id IN {ids:Array(UUID)}`,
                auditIds === null ? {} : { ids: auditIds },
              )
            ).rows,
          ),
    );
    await this.dependencies.traces.appendSessionReads(
      reads.map((read) => ({ organization_id: organizationId, ...read })),
    );
    return reads.length;
  }

  /**
   * Derives `session_reads` once from the audit history retained when the table was
   * introduced (ADR 0060); flushes keep it current afterwards. Rows are idempotent, so a
   * run that fails part-way simply repeats at the next maintenance tick.
   */
  async backfill(): Promise<void> {
    const { prisma, traces, audit } = this.dependencies;
    if (await traces.backfillCompleted(SESSION_READS_BACKFILL)) return;
    let organizations = 0;
    let attributed = 0;
    let after: string | undefined;
    for (;;) {
      const page = await prisma.organization.findMany({
        where: after ? { id: { gt: after } } : {},
        orderBy: { id: "asc" },
        take: BACKFILL_PAGE,
        select: { id: true },
      });
      if (!page.length) break;
      for (const organization of page) {
        attributed += await this.copyAttributedReads(organization.id, null);
        organizations += 1;
      }
      after = page.at(-1)?.id;
    }
    await traces.completeBackfill(SESSION_READS_BACKFILL);
    await audit.write(operatorContext(), {
      action: "audit.projection.backfill",
      detail: { organizations, attributed },
    });
  }
}
