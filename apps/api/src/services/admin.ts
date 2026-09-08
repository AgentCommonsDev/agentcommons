import { z } from "zod";
import { MetricsService } from "./metrics.js";
import { Prisma, type PrismaClient, type ReaderPools } from "@agentcommons/db";
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
  type PolicyCache,
} from "@agentcommons/core";
import type { AuditService } from "./audit.js";
import type { CursorCodec } from "./cursor.js";
import { lockOrganization } from "./auth.js";
import { mutationOperation } from "./mutation.js";
import { readOperation } from "./read-operation.js";
import { ServiceError, type ServiceContext } from "./context.js";

export interface AdminJobs {
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
  >`SELECT id FROM agent_session WHERE organization_id=${organizationId} AND id=${id}::uuid FOR UPDATE`;
  if (locked.length === 0)
    throw new ServiceError(404, "NOT_FOUND", "Session not found.");
  return tx.agentSession.findUniqueOrThrow({ where: { id } });
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
      readers: ReaderPools;
      audit: AuditService;
      cursors: CursorCodec;
      policies: PolicyCache;
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
          await tx.agentSession.update({
            where: { id: current.id },
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
        const current = await session(
          tx,
          caller.organizationId,
          request.session_id,
        );
        const where = {
          organizationId: caller.organizationId,
          sessionId: current.id,
        };
        const chunks = await tx.messageChunk.deleteMany({ where });
        const embeddings = await tx.sessionEmbedding.deleteMany({ where });
        const redactions = await tx.redactionEvent.deleteMany({ where });
        const files = await tx.sessionFile.deleteMany({ where });
        const messages = await tx.message.deleteMany({ where });
        const records = await tx.rawRecord.deleteMany({ where });
        const reason = await this.dependencies.audit.redactText(
          context,
          request.reason,
        );
        if (!current.purgedAt)
          await tx.agentSession.update({
            where: { id: current.id },
            data: {
              title: null,
              firstPrompt: null,
              observedCommits: Prisma.DbNull,
              observedDiffStat: Prisma.DbNull,
              branch: null,
              normalizerContext: {},
              projectedContext: {},
              messageCount: 0,
              toolCallCount: 0,
              inputTokens: 0,
              outputTokens: 0,
              toolsUsed: [],
              purgedAt: new Date(),
              purgedByUserId: caller.userId,
              purgeReason: reason,
            },
          });
        const result = purgeOutputSchema.parse({
          id: current.id,
          updated: current.purgedAt === null,
          manifest: {
            deleted: {
              raw_records: records.count,
              messages: messages.count,
              session_files: files.count,
              message_chunks: chunks.count,
              session_embeddings: embeddings.count,
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
              "ingest_batches",
              "audit_events",
              "installation",
            ],
          },
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
        const [ingest, failures, redactions, jobs] = await Promise.all([
          this.dependencies.prisma.$queryRaw<
            { date: string; count: number }[]
          >`SELECT to_char(received_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS date, count(*)::int AS count FROM ingest_batch WHERE organization_id=${caller.organizationId} GROUP BY 1 ORDER BY 1`,
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
        ]);
        return statusOutputSchema.parse({
          ingest_per_day: ingest,
          failures,
          redaction_hits: redactions.map((row) => ({
            policy_id: row.policyId,
            count: row._sum.count ?? 0,
          })),
          ...jobs,
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
