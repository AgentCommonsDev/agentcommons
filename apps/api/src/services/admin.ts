import { z } from "zod";
import { v7 as uuidv7 } from "uuid";
import type { TraceReaders } from "@agentcommons/traces";
import { MetricsService } from "./metrics.js";
import {
  Prisma,
  lockTracePublication,
  lockTraceSessionControl,
  type PrismaClient,
} from "@agentcommons/db";
import {
  visibilityInputSchema,
  enabledInputSchema,
  installationToolsOutputSchema,
  sessionIdSchema,
  purgeInputSchema,
  purgeOutputSchema,
  auditListInputSchema,
  auditOutputSchema,
  moderationInputSchema,
  moderationOutputSchema,
  statusOutputSchema,
  installationHealInputSchema,
  installationHealOutputSchema,
  installationHealTotalSchema,
  redactionRescanInputSchema,
  jobOutputSchema,
} from "@agentcommons/core";
import type { AuditService } from "./audit.js";
import type { CursorCodec } from "./cursor.js";
import type { TraceQueue } from "./trace-outbox.js";
import { lockOrganization } from "./auth.js";
import { readUpdaterState, readServedManifest } from "./health.js";
import { mutationOperation } from "./mutation.js";
import { readOperation } from "./read-operation.js";
import { offsetPage, wireValue } from "./read-budget.js";
import { ServiceError, type ServiceContext } from "./context.js";

/** The job service as admin operations see it: the trace queue plus rescans and status. */
export interface AdminJobs extends TraceQueue {
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
/** Lock one session's control row for the transaction and return it, or 404. */
async function session(
  tx: Prisma.TransactionClient,
  organizationId: string,
  id: string,
) {
  if (!(await lockTraceSessionControl(tx, organizationId, id)))
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
const auditCursorSchema = z.strictObject({
  id: z.uuid(),
  cutoff: z.iso.datetime(),
});
/** Sort keys of the moderation list as control columns; the request enum admits only these. */
const moderationSort = {
  started_at: "s.started_at",
  last_activity_at: "s.last_activity_at",
  user_email: "u.email",
  harness: "s.harness::text",
  status: "s.status::text",
  visibility: "s.visibility::text",
  purged_at: "s.purged_at",
} as const;
/** One control row of the moderation list as PostgreSQL returns it, with the window total. */
const moderationRowSchema = z.object({
  session_id: z.string(),
  harness: z.string(),
  harness_session_id: z.string(),
  user_email: z.string().nullable(),
  installation_hostname: z.string().nullable(),
  started_at: z.date(),
  last_activity_at: z.date(),
  ended_at: z.date().nullable(),
  status: z.string(),
  visibility: z.string(),
  purged_at: z.date().nullable(),
  published: z.boolean(),
  projection_state: z.string(),
  parent_session_id: z.string().nullable(),
  parent_relation: z.string().nullable(),
  total: z.bigint(),
});
const countRowSchema = z.object({ count: z.bigint() });
/** Sort keys of the installation heal list as columns/derived aliases of the scan. */
const healSort = {
  hostname: "hostname",
  last_seen_at: "last_seen_at",
  first_seen_at: "first_seen_at",
  up_to_date: "up_to_date",
  tools_enabled: "tools_enabled",
} as const;
/** One heal row as PostgreSQL returns it, with the freshness counts as window aggregates. */
const healRowSchema = z.object({
  installation_id: z.string(),
  hostname: z.string(),
  os_user: z.string(),
  platform: z.string(),
  arch: z.string(),
  tools_enabled: z.boolean(),
  hook_sha256: z.string().nullable(),
  up_to_date: z.boolean().nullable(),
  first_seen_at: z.date(),
  last_seen_at: z.date(),
  total: z.bigint(),
  up_to_date_count: z.bigint(),
  unknown_count: z.bigint(),
});
const healTotalsRowSchema = z.object({
  total: z.bigint(),
  up_to_date_count: z.bigint(),
  unknown_count: z.bigint(),
});
/** Derived session fields a purge resets; the manifest and the audit detail list the same set. */
const purgeResetFields = [
  "normalizer_context",
  "projected_context",
  "message_count",
  "tool_call_count",
  "input_tokens",
  "output_tokens",
  "tools_used",
];
export class AdminService {
  private readonly metricsService: MetricsService;
  constructor(
    private readonly dependencies: {
      prisma: PrismaClient;
      readers: TraceReaders;
      audit: AuditService;
      cursors: CursorCodec;
      jobs: AdminJobs;
      /**
       * The release this process runs, whether its host installs new ones and where the
       * host updater's state file is when mounted (env.server).
       */
      server: {
        version: string;
        autoUpdate: boolean;
        updateStateFile?: string;
        /** The served hook manifest file the heal view compares each machine with (§10). */
        hookManifestFile?: string;
      };
    },
  ) {
    this.metricsService = new MetricsService(dependencies);
  }
  metrics(context: ServiceContext, group: unknown, input: unknown) {
    return this.metricsService.get(context, group, input);
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
        const request = enabledInputSchema.parse(input);
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
            reset_fields: purgeResetFields,
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
            reset_fields: purgeResetFields,
          },
        };
      },
    );
  }
  /**
   * Every session the organization holds in control, whatever its publication, visibility
   * or purge state, so an admin lists the same set the visibility and purge routes act on
   * (§9.5). One control scan per page carries the rows and the total as a window count; the
   * published title, repository and message count of the page's rows come from one
   * id-bounded read of `api_ro.sessions` under the same publication fence.
   */
  sessions(context: ServiceContext, input: unknown) {
    return readOperation(
      this.dependencies.audit,
      context,
      {
        action: "sessions.moderation",
        resourceType: "session",
        detail: input ?? null,
      },
      async (caller) => {
        const request = moderationInputSchema.parse(input);
        const binding = wireValue({
          operation: "sessions.moderation",
          organization: caller.organizationId,
          ...request,
          cursor: null,
        });
        let total: number | undefined;
        const page = await offsetPage(
          this.dependencies.cursors,
          binding,
          request.cursor,
          request.limit,
          (offset, take) =>
            this.dependencies.readers.read(caller, async (client) => {
              const f = request.filters;
              const conditions = [
                Prisma.sql`s.organization_id=${caller.organizationId}`,
                ...(f.user_email === undefined
                  ? []
                  : [Prisma.sql`u.email=${f.user_email}`]),
                ...(f.harness === undefined
                  ? []
                  : [Prisma.sql`s.harness::text=${f.harness}`]),
                ...(f.status === undefined
                  ? []
                  : [Prisma.sql`s.status::text=${f.status}`]),
                ...(f.visibility === undefined
                  ? []
                  : [Prisma.sql`s.visibility::text=${f.visibility}`]),
                ...(f.purged === undefined
                  ? []
                  : [
                      f.purged
                        ? Prisma.sql`s.purged_at IS NOT NULL`
                        : Prisma.sql`s.purged_at IS NULL`,
                    ]),
                ...(f.published === undefined
                  ? []
                  : [
                      f.published
                        ? Prisma.sql`s.published_revision>0`
                        : Prisma.sql`s.published_revision=0`,
                    ]),
                ...(f.session_id === undefined
                  ? []
                  : [Prisma.sql`s.id=${f.session_id}::uuid`]),
                ...(f.since === undefined
                  ? []
                  : [Prisma.sql`s.started_at>=${new Date(f.since)}`]),
                ...(f.until === undefined
                  ? []
                  : [Prisma.sql`s.started_at<${new Date(f.until)}`]),
                ...(request.roots_only
                  ? [Prisma.sql`s.parent_session_id IS NULL`]
                  : []),
              ];
              const from = Prisma.sql`FROM trace_session_control s LEFT JOIN "user" u ON u.id=s.user_id LEFT JOIN installation i ON i.organization_id=s.organization_id AND i.id=s.installation_id WHERE ${Prisma.join(conditions, " AND ")}`;
              const order = Prisma.raw(
                `${moderationSort[request.sort ?? "started_at"]} ${request.order === "asc" ? "ASC" : "DESC"} NULLS LAST`,
              );
              const rows = moderationRowSchema
                .array()
                .parse(
                  await client.control.$queryRaw(
                    Prisma.sql`SELECT s.id::text AS session_id,s.harness::text AS harness,s.harness_session_id,u.email AS user_email,i.hostname AS installation_hostname,s.started_at,s.last_activity_at,s.ended_at,s.status::text AS status,s.visibility::text AS visibility,s.purged_at,s.published_revision>0 AS published,s.projection_state,s.parent_session_id::text AS parent_session_id,s.parent_relation::text AS parent_relation,count(*) OVER () AS total ${from} ORDER BY ${order},s.id LIMIT ${take} OFFSET ${offset}`,
                  ),
                );
              // A window past the last row carries no aggregate; only then is a count of
              // the predicate (with no window) needed to state the total.
              const first = rows[0];
              total = first
                ? Number(first.total)
                : offset === 0
                  ? 0
                  : Number(
                      countRowSchema
                        .array()
                        .parse(
                          await client.control.$queryRaw(
                            Prisma.sql`SELECT count(*) AS count ${from}`,
                          ),
                        )[0]?.count ?? 0,
                    );
              // Only published rows have a read model; one id-bounded read serves the page.
              const published = rows
                .filter((row) => row.published)
                .map((row) => row.session_id);
              const details = new Map<
                string,
                {
                  title: string | null;
                  repo_name: string | null;
                  message_count: number;
                }
              >();
              if (published.length) {
                const result = await client.query(
                  "SELECT session_id,title,repo_name,message_count FROM api_ro.sessions WHERE session_id IN {ids:Array(UUID)}",
                  { ids: published },
                );
                for (const row of result.rows)
                  details.set(String(row.session_id), {
                    title: typeof row.title === "string" ? row.title : null,
                    repo_name:
                      typeof row.repo_name === "string" ? row.repo_name : null,
                    message_count: Number(row.message_count),
                  });
              }
              return rows.map((row) => {
                const detail = details.get(row.session_id);
                return {
                  session_id: row.session_id,
                  harness: row.harness,
                  harness_session_id: row.harness_session_id,
                  user_email: row.user_email,
                  installation_hostname: row.installation_hostname,
                  started_at: row.started_at.toISOString(),
                  last_activity_at: row.last_activity_at.toISOString(),
                  ended_at: row.ended_at?.toISOString() ?? null,
                  status: row.status,
                  visibility: row.visibility,
                  purged_at: row.purged_at?.toISOString() ?? null,
                  published: row.published,
                  projection_state: row.projection_state,
                  parent_session_id: row.parent_session_id,
                  parent_relation: row.parent_relation,
                  title: detail?.title ?? null,
                  repo_name: detail?.repo_name ?? null,
                  message_count: detail?.message_count ?? null,
                };
              });
            }),
        );
        if (total === undefined)
          throw new Error("The moderation total is unavailable.");
        return moderationOutputSchema.parse({
          ...page,
          total: { sessions: total },
        });
      },
      {
        permission: "admin",
        describeResult: (result) => ({
          row_count: result.items.length,
          total: result.total,
        }),
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
        const binding = wireValue({
          organizationId: caller.organizationId,
          operation: "audit.list",
          input: query,
        });
        const position = cursor
          ? this.dependencies.cursors.decode(cursor, binding, auditCursorSchema)
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
        const userIds = [
          ...new Set(
            rows.flatMap((row) => (row.userId === null ? [] : [row.userId])),
          ),
        ];
        const emails = new Map(
          (userIds.length
            ? await this.dependencies.prisma.user.findMany({
                where: { id: { in: userIds } },
                select: { id: true, email: true },
              })
            : []
          ).map((user) => [user.id, user.email]),
        );
        const items = rows.slice(0, request.limit).map((row) => ({
          id: row.id,
          organization_id: row.organizationId,
          ts: row.ts.toISOString(),
          request_id: row.requestId,
          user_id: row.userId,
          user_email:
            row.userId === null ? null : (emails.get(row.userId) ?? null),
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
      {
        describeResult: (result) => ({ row_count: result.items.length }),
        permission: "admin",
      },
    );
  }
  status(context: ServiceContext) {
    return readOperation(
      this.dependencies.audit,
      context,
      { action: "status", resourceType: "organization" },
      async (caller) => {
        const [ingest, failures, redactions, jobs, projection, updater] =
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
            this.dependencies.server.updateStateFile
              ? readUpdaterState(this.dependencies.server.updateStateFile)
              : null,
          ]);
        const state = projection[0];
        if (!state) throw new Error("The projection status is unavailable.");
        return statusOutputSchema.parse({
          server: {
            version: this.dependencies.server.version,
            auto_update: this.dependencies.server.autoUpdate,
            updater,
          },
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
      {
        permission: "admin",
      },
    );
  }
  /**
   * Every installation the organization holds, with the hook bundle digest of its latest
   * upload and whether that digest matches the bundle this instance serves (§10), so an
   * admin sees the rollout heal state the deploy left. One control scan per page carries
   * the rows and, as window aggregates, the freshness counts over the whole matching set;
   * only an empty page past the last row costs a second aggregate. The served manifest is
   * read once per request from the same file the static route serves.
   */
  installations(context: ServiceContext, input: unknown) {
    return readOperation(
      this.dependencies.audit,
      context,
      {
        action: "installations.heal",
        resourceType: "installation",
        detail: input ?? null,
      },
      async (caller) => {
        const request = installationHealInputSchema.parse(input);
        const manifest = this.dependencies.server.hookManifestFile
          ? await readServedManifest(this.dependencies.server.hookManifestFile)
          : null;
        const sha = manifest?.sha256 ?? null;
        const binding = wireValue({
          operation: "installations.heal",
          organization: caller.organizationId,
          sha,
          ...request,
          cursor: null,
        });
        const where = (extra: readonly Prisma.Sql[] = []) =>
          Prisma.sql`FROM installation WHERE ${Prisma.join(
            [
              Prisma.sql`organization_id=${caller.organizationId}`,
              ...(request.filters.hostname === undefined
                ? []
                : [
                    Prisma.sql`position(lower(${request.filters.hostname}) in lower(hostname))>0`,
                  ]),
              ...extra,
            ],
            " AND ",
          )}`;
        // The served digest bounds every freshness comparison; a null digest (no manifest)
        // makes each row and count indeterminate, never behind.
        const upToDate = Prisma.sql`(CASE WHEN ${sha}::text IS NULL OR hook_sha256 IS NULL THEN NULL ELSE hook_sha256=${sha} END)`;
        const current = Prisma.sql`(${sha}::text IS NOT NULL AND hook_sha256=${sha})`;
        const indeterminate = Prisma.sql`(${sha}::text IS NULL OR hook_sha256 IS NULL)`;
        let totals: z.infer<typeof installationHealTotalSchema> | undefined;
        const page = await offsetPage(
          this.dependencies.cursors,
          binding,
          request.cursor,
          request.limit,
          async (offset, take) => {
            const order = Prisma.raw(
              `${healSort[request.sort ?? "last_seen_at"]} ${request.order === "asc" ? "ASC" : "DESC"} NULLS LAST`,
            );
            const rows = healRowSchema
              .array()
              .parse(
                await this.dependencies.prisma.$queryRaw(
                  Prisma.sql`SELECT id::text AS installation_id,hostname,os_user,platform,arch,tools_enabled,hook_sha256,${upToDate} AS up_to_date,first_seen_at,last_seen_at,count(*) OVER () AS total,count(*) FILTER (WHERE ${current}) OVER () AS up_to_date_count,count(*) FILTER (WHERE ${indeterminate}) OVER () AS unknown_count ${where()} ORDER BY ${order},id LIMIT ${take} OFFSET ${offset}`,
                ),
              );
            const first = rows[0];
            const counts =
              first !== undefined
                ? {
                    total: first.total,
                    up_to_date_count: first.up_to_date_count,
                    unknown_count: first.unknown_count,
                  }
                : offset === 0
                  ? { total: 0n, up_to_date_count: 0n, unknown_count: 0n }
                  : healTotalsRowSchema.parse(
                      (
                        await this.dependencies.prisma.$queryRaw<unknown[]>(
                          Prisma.sql`SELECT count(*) AS total,count(*) FILTER (WHERE ${current}) AS up_to_date_count,count(*) FILTER (WHERE ${indeterminate}) AS unknown_count ${where()}`,
                        )
                      )[0],
                    );
            const total = Number(counts.total);
            const upToDateCount = Number(counts.up_to_date_count);
            const unknown = Number(counts.unknown_count);
            totals = installationHealTotalSchema.parse({
              installations: total,
              up_to_date: upToDateCount,
              behind: total - upToDateCount - unknown,
              unknown,
            });
            return rows.map((row) => ({
              installation_id: row.installation_id,
              hostname: row.hostname,
              os_user: row.os_user,
              platform: row.platform,
              arch: row.arch,
              tools_enabled: row.tools_enabled,
              hook_sha256: row.hook_sha256,
              up_to_date: row.up_to_date,
              first_seen_at: row.first_seen_at.toISOString(),
              last_seen_at: row.last_seen_at.toISOString(),
            }));
          },
        );
        if (totals === undefined)
          throw new Error("The installation heal totals are unavailable.");
        return installationHealOutputSchema.parse({
          ...page,
          manifest: manifest
            ? { version: manifest.version, sha256: manifest.sha256 }
            : null,
          total: totals,
        });
      },
      {
        permission: "admin",
        describeResult: (result) => ({
          row_count: result.items.length,
          total: result.total,
        }),
      },
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
