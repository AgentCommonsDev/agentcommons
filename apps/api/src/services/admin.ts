import { z } from "zod";
import { v7 as uuidv7 } from "uuid";
import type { TraceReaders } from "@agentcommons/traces";
import { MetricsService } from "./metrics.js";
import type { Prisma } from "@agentcommons/db";
import { lockTracePublication, type PrismaClient } from "@agentcommons/db";
import {
  visibilityInputSchema,
  installationToolsInputSchema,
  installationToolsOutputSchema,
  sessionIdSchema,
  purgeInputSchema,
  purgeOutputSchema,
  auditListInputSchema,
  auditOutputSchema,
  statusOutputSchema,
  redactionRescanInputSchema,
  jobOutputSchema,
  jsonValueSchema,
} from "@agentcommons/core";
import type { AuditService } from "./audit.js";
import type { CursorCodec } from "./cursor.js";
import { lockOrganization } from "./auth.js";
import { mutationOperation } from "./mutation.js";
import { readOperation } from "./read-operation.js";
import { ServiceError, type ServiceContext } from "./context.js";

export interface AdminJobs {
  enqueue(
    tx: Prisma.TransactionClient,
    data: { organizationId: string; sessionId: string; outboxId: string },
  ): Promise<void>;
  rescan(
    tx: Prisma.TransactionClient,
    context: ServiceContext,
    input: z.infer<typeof redactionRescanInputSchema>,
  ): Promise<string>;
  status(organizationId: string): Promise<{
    queue_depth: number;
    embedding_backlog: number;
    embedding_daily_tokens: string;
    embedding_daily_cost: string;
  }>;
}
async function session(
  tx: Prisma.TransactionClient,
  organizationId: string,
  id: string,
) {
  const locked = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM trace_session_control WHERE organization_id=${organizationId} AND id=${id}::uuid FOR UPDATE`;
  if (locked.length === 0)
    throw new ServiceError(404, "NOT_FOUND", "Session not found.");
  return tx.traceSessionControl.findUniqueOrThrow({
    where: { organizationId_id: { organizationId, id } },
  });
}
const auditSort = {
  ts: "ts",
  action: "action",
  user_id: "userId",
  status_code: "statusCode",
  duration_ms: "durationMs",
  transport: "transport",
  request_id: "requestId",
} as const;
export class AdminService {
  constructor(
    private readonly dependencies: {
      prisma: PrismaClient;
      readers: TraceReaders;
      audit: AuditService;
      cursors: CursorCodec;
      jobs: AdminJobs;
    },
  ) {}
  metrics(context: ServiceContext, group: unknown, input: unknown) {
    return new MetricsService(this.dependencies).get(context, group, input);
  }
  setInstallationTools(
    context: ServiceContext,
    installationId: string,
    input: unknown,
  ) {
    return mutationOperation(
      this.dependencies,
      context,
      "admin",
      {
        action: "installations.tools",
        resourceType: "installation",
      },
      async (tx, caller) => {
        const id = sessionIdSchema.parse(installationId);
        const request = installationToolsInputSchema.parse(input);
        await lockOrganization(tx, caller);
        const current = await tx.installation.findUnique({
          where: {
            organizationId_id: { organizationId: caller.organizationId, id },
          },
        });
        if (!current)
          throw new ServiceError(404, "NOT_FOUND", "Installation not found.");
        await tx.installation.update({
          where: {
            organizationId_id: { organizationId: caller.organizationId, id },
          },
          data: { toolsEnabled: request.enabled },
        });
        return {
          result: installationToolsOutputSchema.parse({
            installation_id: id,
            tools_enabled: request.enabled,
          }),
          resourceIds: [id],
          detail: {
            enabled: request.enabled,
            previous_enabled: current.toolsEnabled,
            reason: request.reason,
          },
        };
      },
    );
  }
  setVisibility(context: ServiceContext, input: unknown) {
    return mutationOperation(
      this.dependencies,
      context,
      "admin",
      { action: "sessions.visibility", resourceType: "session" },
      async (tx, caller) => {
        const request = visibilityInputSchema.parse(input);
        await lockOrganization(tx, caller);
        await lockTracePublication(tx, caller.organizationId, "write");
        const current = await session(
          tx,
          caller.organizationId,
          request.session_id,
        );
        if (current.purgedAt)
          throw new ServiceError(
            409,
            "SESSION_PURGED",
            "A purged session cannot change visibility.",
          );
        const updated = current.visibility !== request.visibility;
        if (updated)
          await tx.traceSessionControl.update({
            where: {
              organizationId_id: {
                organizationId: caller.organizationId,
                id: current.id,
              },
            },
            data: { visibility: request.visibility },
          });
        return {
          result: { id: current.id, updated },
          resourceIds: [current.id],
          detail: { visibility: request.visibility, reason: request.reason },
        };
      },
    );
  }
  purge(context: ServiceContext, input: unknown) {
    return mutationOperation(
      this.dependencies,
      context,
      "admin",
      { action: "sessions.purge", resourceType: "session" },
      async (tx, caller) => {
        const request = purgeInputSchema.parse(input);
        await lockOrganization(tx, caller);
        await lockTracePublication(tx, caller.organizationId, "write");
        const current = await session(
          tx,
          caller.organizationId,
          request.session_id,
        );
        const where = {
          organizationId: caller.organizationId,
          sessionId: current.id,
        };
        const reason = await this.dependencies.audit.redactText(
          context,
          request.reason,
          tx,
        );
        let manifest = current.purgeManifest;
        if (!current.purgedAt) {
          const redactions = await tx.redactionEvent.deleteMany({ where });
          await tx.traceOutbox.deleteMany({ where });
          const revision = current.acceptedRevision + 1n;
          manifest = {
            deleted: {
              raw_records: null,
              messages: null,
              session_files: null,
              message_chunks: null,
              session_embeddings: null,
              redaction_events: redactions.count,
            },
            nulled_fields: [
              "title",
              "first_prompt",
              "observed_commits",
              "observed_diff_stat",
              "branch",
            ],
            reset_fields: [
              "normalizer_context",
              "projected_context",
              "message_count",
              "tool_call_count",
              "input_tokens",
              "output_tokens",
              "tools_used",
            ],
            retained: [
              "session_identity",
              "ingest_receipts",
              "audit_events",
              "installation",
            ],
          };
          await tx.traceSessionControl.update({
            where: {
              organizationId_id: {
                organizationId: caller.organizationId,
                id: current.id,
              },
            },
            data: {
              purgedAt: new Date(),
              purgedByUserId: caller.userId,
              purgeReason: reason,
              purgeManifest: manifest,
              normalizerContext: {},
              projectedContext: {},
              projectionError: null,
              projectionState: "queued",
              embeddingRevision: null,
              acceptedRevision: revision,
            },
          });
          const outboxId = uuidv7();
          await tx.traceOutbox.create({
            data: {
              id: outboxId,
              ...where,
              revision,
              kind: "purge",
              payload: {},
            },
          });
          await this.dependencies.jobs.enqueue(tx, { ...where, outboxId });
        }
        const result = purgeOutputSchema.parse({
          id: current.id,
          updated: current.purgedAt === null,
          cleanup: current.purgeCompletedAt ? "completed" : "queued",
          manifest,
        });
        return {
          result,
          resourceIds: [current.id],
          detail: {
            reason,
            manifest: result.manifest,
            reset_fields: [
              "normalizer_context",
              "projected_context",
              "message_count",
              "tool_call_count",
              "input_tokens",
              "output_tokens",
              "tools_used",
            ],
          },
        };
      },
    );
  }
  auditLog(context: ServiceContext, input: unknown) {
    return readOperation(
      this.dependencies.audit,
      context,
      {
        action: "audit.list",
        resourceType: "audit_event",
        detail: input ?? null,
      },
      async (caller) => {
        const request = auditListInputSchema.parse(input);
        const { cursor, ...query } = request;
        const binding = jsonValueSchema.parse(
          JSON.parse(
            JSON.stringify({
              organizationId: caller.organizationId,
              operation: "audit.list",
              input: query,
            }),
          ),
        );
        const position = cursor
          ? this.dependencies.cursors.decode(
              cursor,
              binding,
              z.strictObject({ id: z.uuid(), cutoff: z.iso.datetime() }),
            )
          : null;
        const clock = position
          ? new Date(position.cutoff)
          : (
              await this.dependencies.prisma.$queryRaw<
                { cutoff: Date }[]
              >`SELECT date_trunc('milliseconds',clock_timestamp()) AS cutoff`
            )[0]?.cutoff;
        if (!clock) throw new Error("The audit snapshot time is unavailable.");
        const f = request.filters;
        const rows = await this.dependencies.prisma.auditEvent.findMany({
          where: {
            organizationId: caller.organizationId,
            ...(f.user_id ? { userId: f.user_id } : {}),
            ...(f.api_key_id ? { apiKeyId: f.api_key_id } : {}),
            ...(f.request_id ? { requestId: f.request_id } : {}),
            ...(f.resource_id ? { resourceIds: { has: f.resource_id } } : {}),
            ...(f.action ? { action: f.action } : {}),
            ...(f.transport ? { transport: f.transport } : {}),
            ...(f.status_code ? { statusCode: f.status_code } : {}),
            ts: {
              ...(f.since ? { gte: new Date(f.since) } : {}),
              lte:
                f.until && new Date(f.until) < clock
                  ? new Date(f.until)
                  : clock,
            },
          },
          orderBy: [
            { [auditSort[request.sort ?? "ts"]]: request.order },
            { id: "asc" },
          ],
          ...(position ? { cursor: { id: position.id }, skip: 1 } : {}),
          take: request.limit + 1,
        });
        const items = rows.slice(0, request.limit).map((row) => ({
          id: row.id,
          organization_id: row.organizationId,
          ts: row.ts.toISOString(),
          request_id: row.requestId,
          user_id: row.userId,
          api_key_id: row.apiKeyId,
          installation_id: row.installationId,
          auth_method: row.authMethod,
          ip: row.ip,
          user_agent: row.userAgent,
          transport: row.transport,
          action: row.action,
          resource_type: row.resourceType,
          resource_ids: row.resourceIds,
          status_code: row.statusCode,
          duration_ms: row.durationMs,
          detail: row.detail,
        }));
        return auditOutputSchema.parse({
          items,
          cursor:
            rows.length > request.limit
              ? this.dependencies.cursors.encode(binding, {
                  id: items.at(-1)?.id ?? "",
                  cutoff: clock.toISOString(),
                })
              : null,
        });
      },
      (result) => ({ row_count: result.items.length }),
      "admin",
    );
  }
  status(context: ServiceContext) {
    return readOperation(
      this.dependencies.audit,
      context,
      { action: "status", resourceType: "organization" },
      async (caller) => {
        const [ingest, failures, redactions, jobs, projection] =
          await Promise.all([
            this.dependencies.prisma.$queryRaw<
              { date: string; count: number }[]
            >`SELECT to_char(received_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS date, count(*)::int AS count FROM trace_receipt WHERE organization_id=${caller.organizationId} GROUP BY 1 ORDER BY 1`,
            this.dependencies.prisma.$queryRaw<
              { date: string; count: number }[]
            >`SELECT to_char(ts AT TIME ZONE 'UTC','YYYY-MM-DD') AS date, count(*)::int AS count FROM audit_event WHERE organization_id=${caller.organizationId} AND status_code>=400 GROUP BY 1 ORDER BY 1`,
            this.dependencies.prisma.redactionEvent.groupBy({
              by: ["policyId"],
              where: { organizationId: caller.organizationId },
              _sum: { count: true },
              orderBy: { policyId: "asc" },
            }),
            this.dependencies.jobs.status(caller.organizationId),
            this.dependencies.prisma.$queryRaw<
              {
                queued_sessions: number;
                outbox_batches: number;
                oldest_accepted_at: Date | null;
                failed_sessions: number;
                waiting_source_sessions: number;
                pending_audit_events: number;
              }[]
            >`
            SELECT
              (SELECT count(*)::int FROM trace_session_control WHERE organization_id=${caller.organizationId} AND projection_state IN ('queued','waiting_source','failed')) AS queued_sessions,
              (SELECT count(*)::int FROM trace_outbox WHERE organization_id=${caller.organizationId}) AS outbox_batches,
              (SELECT min(created_at) FROM trace_outbox WHERE organization_id=${caller.organizationId}) AS oldest_accepted_at,
              (SELECT count(*)::int FROM trace_session_control WHERE organization_id=${caller.organizationId} AND projection_state='failed') AS failed_sessions,
              (SELECT count(*)::int FROM trace_session_control WHERE organization_id=${caller.organizationId} AND projection_state='waiting_source') AS waiting_source_sessions,
              (SELECT count(*)::int FROM trace_audit_outbox o JOIN audit_event a ON a.id=o.audit_id WHERE a.organization_id=${caller.organizationId}) AS pending_audit_events`,
          ]);
        const state = projection[0];
        if (!state) throw new Error("The projection status is unavailable.");
        return statusOutputSchema.parse({
          ingest_per_day: ingest,
          failures,
          redaction_hits: redactions.map((row) => ({
            policy_id: row.policyId,
            count: row._sum.count ?? 0,
          })),
          ...jobs,
          projection: {
            ...state,
            oldest_accepted_at: state.oldest_accepted_at?.toISOString() ?? null,
          },
        });
      },
      undefined,
      "admin",
    );
  }
  rescan(context: ServiceContext, input: unknown) {
    return mutationOperation(
      this.dependencies,
      context,
      "admin",
      { action: "redaction.rescan", resourceType: "redaction_policy" },
      async (tx, caller) => {
        const request = redactionRescanInputSchema.parse(input);
        await lockOrganization(tx, caller);
        if (request.policyIds) {
          const ids = [...new Set(request.policyIds)];
          if (
            (await tx.redactionPolicy.count({
              where: { organizationId: caller.organizationId, id: { in: ids } },
            })) !== ids.length
          )
            throw new ServiceError(
              404,
              "NOT_FOUND",
              "A redaction policy was not found.",
            );
        }
        const sanitized = {
          ...request,
          reason: await this.dependencies.audit.redactText(
            context,
            request.reason,
            tx,
          ),
        };
        const jobId = await this.dependencies.jobs.rescan(
          tx,
          context,
          sanitized,
        );
        return {
          result: jobOutputSchema.parse({ job_id: jobId }),
          resourceIds: request.policyIds ?? [],
          detail: { ...request, job_id: jobId },
        };
      },
    );
  }
}
