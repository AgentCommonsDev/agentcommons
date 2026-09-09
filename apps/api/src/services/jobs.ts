import {
  completeRunSession,
  traceRescanPayloadSchema,
} from "./trace-rescan.js";
import { setImmediate } from "node:timers/promises";
import {
  AUDIT_PROJECTION_BATCH,
  type TraceAuditProjectionService,
} from "./trace-audit-projection.js";
import type { TraceProjectionService } from "./trace-projection.js";
import type { BillingMeterService } from "./billing-meter.js";
import { organizationEmbeddingSetting } from "../embeddings/settings.js";
import PgBoss from "pg-boss";
import type { AuthConfiguration } from "../auth/config.js";
import {
  embeddingJobSchema,
  type EmbeddingJob,
  type EmbeddingService,
} from "../embeddings/service.js";
import { z } from "zod";
import { v7 as uuidv7 } from "uuid";
import type { Prisma } from "@agentcommons/db";
import {
  JOB_QUEUES,
  lockTracePublication,
  lockTraceSessionControl,
  type PrismaClient,
} from "@agentcommons/db";
import type {
  CallerContext,
  redactionRescanInputSchema,
} from "@agentcommons/core";
import {
  callerContextSchema,
  jobProgressSchema,
  sessionIdSchema,
} from "@agentcommons/core";
import { reauthorizeJob } from "../auth/jobs.js";
import { cookieCaller } from "../auth/identity.js";
import { operatorContext, workerActor } from "../auth/bootstrap.js";
import { lockOrganization } from "./auth.js";
import type { AuditService } from "./audit.js";
import { renderScope, type DashboardService } from "./dashboards.js";
import { readOperation } from "./read-operation.js";
import {
  requirePermission,
  ServiceError,
  type ServiceContext,
} from "./context.js";
import type { AdminJobs } from "./admin.js";

type RescanJob = z.infer<typeof traceRescanPayloadSchema>;
const traceProjectionJobSchema = z.strictObject({
  organizationId: z.string().min(1),
  sessionId: z.uuid(),
  outboxId: z.uuid(),
});
type TraceProjectionJob = z.infer<typeof traceProjectionJobSchema>;
const welcomeJobSchema = z.strictObject({ userId: z.string().min(1) });
const catchupJobSchema = z.strictObject({ organizationId: z.string().min(1) });
/** Callers who rendered a dashboard within this window get their dashboards pre-rendered (§10). */
const PRERENDER_WINDOW_DAYS = 7;
/** Cache scopes pre-rendered per organization and run, most recently active first. */
const PRERENDER_SCOPES_PER_ORGANIZATION = 20;
interface Dependencies {
  prisma: PrismaClient;
  audit: AuditService;
  connectionString: string;
  auditRetentionDays: number;
  authConfiguration: AuthConfiguration;
  onError: (error: Error) => void;
  embeddings?: EmbeddingService;
  billingMeter?: BillingMeterService;
  /** When present, saved dashboards are pre-rendered hourly for recently active callers. */
  dashboards?: DashboardService;
  traces: TraceProjectionService;
  traceAudit: TraceAuditProjectionService;
}

/** The supported pg-boss transaction adapter; Prisma supplies the existing transaction. */
function prismaJobDatabase(tx: Prisma.TransactionClient): PgBoss.Db {
  return {
    async executeSql(sql: string, values: unknown[]) {
      return { rows: await tx.$queryRawUnsafe<unknown[]>(sql, ...values) };
    },
  };
}

export class JobService implements AdminJobs {
  readonly boss: PgBoss;
  private readonly saas: boolean;
  constructor(private readonly dependencies: Dependencies) {
    this.saas = dependencies.authConfiguration.instanceMode === "saas";
    this.boss = new PgBoss({
      connectionString: dependencies.connectionString,
      migrate: false,
      pollingIntervalSeconds: 1,
    });
    this.boss.on("error", () => {
      dependencies.onError(
        new Error("The background job service encountered a database error."),
      );
    });
  }

  async enqueue(
    tx: Prisma.TransactionClient,
    data: TraceProjectionJob,
  ): Promise<void> {
    const id = await this.boss.send(JOB_QUEUES.traceProjection, data, {
      db: prismaJobDatabase(tx),
      retryLimit: 10,
      retryDelay: 10,
      retryBackoff: true,
    });
    if (!id) throw new Error("The accepted trace could not be queued.");
  }
  private async recoverTraceOutboxes(): Promise<void> {
    const pending = await this.dependencies.prisma.$queryRaw<
      { id: string; organizationId: string; sessionId: string }[]
    >`
      SELECT coalesce(o.id,c.id) AS id,c.organization_id AS "organizationId",c.id AS "sessionId"
      FROM trace_session_control c LEFT JOIN LATERAL (
        SELECT id,organization_id,session_id FROM trace_outbox
        WHERE organization_id=c.organization_id AND session_id=c.id ORDER BY revision LIMIT 1
      ) o ON true WHERE (o.id IS NOT NULL OR c.redaction_cleaned_generation<c.redaction_generation) AND (c.purged_at IS NULL OR c.purge_completed_at IS NULL)
      AND (c.projection_lease_until IS NULL OR c.projection_lease_until<=now())
      ORDER BY c.projection_attempt_at NULLS FIRST,c.organization_id,c.id LIMIT 100`;
    for (const row of pending)
      await this.boss.send(
        JOB_QUEUES.traceProjection,
        {
          organizationId: row.organizationId,
          sessionId: row.sessionId,
          outboxId: row.id,
        },
        {
          singletonKey: row.sessionId,
          singletonSeconds: 60,
          retryLimit: 10,
          retryDelay: 10,
          retryBackoff: true,
        },
      );
  }

  async enqueueWelcome(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<void> {
    if (!this.saas) return;
    await tx.$queryRaw`SELECT id FROM "user" WHERE id=${userId} FOR UPDATE`;
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (
      !user.emailVerified ||
      user.welcomeQueuedAt ||
      user.banned ||
      !(await tx.member.count({
        where: { userId, removedAt: null, suspended: false },
      }))
    )
      return;
    const jobId = await this.boss.send(
      JOB_QUEUES.welcome,
      { userId },
      {
        db: prismaJobDatabase(tx),
        singletonKey: userId,
        retryLimit: 10,
        retryDelay: 30,
        retryBackoff: true,
      },
    );
    if (!jobId) throw new Error("Welcome email could not be queued.");
    await tx.user.update({
      where: { id: userId },
      data: { welcomeQueuedAt: new Date() },
    });
  }

  async start(): Promise<void> {
    await this.boss.start();
    await this.boss.work(JOB_QUEUES.traceAudit, async () => {
      while (
        (await this.dependencies.traceAudit.flush()) === AUDIT_PROJECTION_BATCH
      )
        await setImmediate();
    });
    await this.boss.schedule(
      JOB_QUEUES.traceAudit,
      "* * * * *",
      {},
      { retryLimit: 5, retryDelay: 10, expireInSeconds: 180 },
    );
    await this.boss.send(
      JOB_QUEUES.traceAudit,
      {},
      { singletonKey: "startup", singletonSeconds: 60 },
    );
    await this.boss.work<unknown>(JOB_QUEUES.traceProjection, async (jobs) => {
      for (const job of jobs) {
        const data = traceProjectionJobSchema.parse(job.data);
        await this.dependencies.traces.process(
          data.organizationId,
          data.sessionId,
        );
      }
    });
    await this.recoverTraceOutboxes();
    if (this.dependencies.billingMeter) {
      await this.boss.work(JOB_QUEUES.billingMeter, async () =>
        this.dependencies.billingMeter?.flush(),
      );
      await this.boss.schedule(
        JOB_QUEUES.billingMeter,
        "* * * * *",
        {},
        { retryLimit: 3, retryDelay: 10 },
      );
      await this.boss.send(
        JOB_QUEUES.billingMeter,
        {},
        { singletonKey: "startup", singletonSeconds: 60 },
      );
    }
    const { mail, publicUrl } = this.dependencies.authConfiguration;
    if (this.saas && mail) {
      await this.boss.work<unknown>(JOB_QUEUES.welcome, async (jobs) => {
        for (const job of jobs) {
          const data = welcomeJobSchema.parse(job.data);
          const user = await this.dependencies.prisma.user.findUnique({
            where: { id: data.userId },
          });
          if (!user?.emailVerified || user.banned) continue;
          await this.dependencies.audit.write(operatorContext(), {
            action: "email.welcome",
            actor: { userId: user.id, apiKeyId: null, authMethod: "worker" },
            detail: { job_id: job.id },
          });
          await mail.send({
            to: user.email,
            kind: "welcome",
            url: publicUrl,
            id: `welcome-${user.id}`,
          });
        }
      });
    }
    if (this.dependencies.embeddings) {
      await this.dependencies.embeddings.initialize();
      await this.boss.work<unknown>(JOB_QUEUES.embedding, async (jobs) => {
        for (const job of jobs) {
          const data = embeddingJobSchema.parse(job.data);
          const result = await this.dependencies.embeddings?.process(data);
          if (!result || result.complete) continue;
          const startAfter = result.deferredUntil ?? undefined;
          await this.dependencies.prisma.$transaction(async (tx) => {
            await this.enqueueEmbedding(data, tx, startAfter);
            await this.dependencies.audit.write(
              operatorContext(),
              {
                action: "embeddings.schedule",
                resourceType: "session",
                resourceIds: [data.sessionId],
                actor: workerActor(data.organizationId),
                detail: { deferred_until: startAfter?.toISOString() ?? null },
              },
              tx,
            );
          });
        }
      });
      await this.boss.work<unknown>(
        JOB_QUEUES.embeddingCatchup,
        async (jobs) => {
          for (const job of jobs) {
            const data = catchupJobSchema.parse(job.data);
            await this.catchupEmbeddings(data.organizationId);
          }
        },
      );
      await this.catchupEmbeddings();
    }
    await this.boss.work<unknown>(
      JOB_QUEUES.rescan,
      { includeMetadata: true },
      async (jobs) => {
        for (const job of jobs) {
          const data = traceRescanPayloadSchema.parse(job.data);
          try {
            await this.processRescan(data);
          } catch (error) {
            const terminal =
              job.retryCount >= job.retryLimit ||
              (error instanceof ServiceError && error.statusCode === 403);
            await this.dependencies.prisma.$transaction(async (tx) => {
              await tx.redactionRun.updateMany({
                where: {
                  organizationId: data.organizationId,
                  id: data.runId,
                  state: { not: "completed" },
                },
                data: {
                  state: terminal ? "failed" : "queued",
                  error:
                    error instanceof ServiceError && error.statusCode === 403
                      ? "The initiating account no longer has permission to run this rescan."
                      : "The rescan could not finish. Review the job service logs and start another scan.",
                },
              });
              await this.dependencies.audit.write(
                this.jobContext(data),
                {
                  action: "redaction.rescan.session",
                  statusCode:
                    error instanceof ServiceError ? error.statusCode : 500,
                  resourceType: "redaction_run",
                  resourceIds: [data.runId],
                  detail: { failed: true, retrying: !terminal },
                },
                tx,
              );
            });
            if (!terminal)
              throw new Error(
                "Rescan interrupted; retry from the committed checkpoint.",
              );
          }
        }
      },
    );
    await this.boss.work<unknown>(JOB_QUEUES.maintenance, async () => {
      await this.maintenance();
    });
    await this.boss.schedule(
      JOB_QUEUES.maintenance,
      "*/10 * * * *",
      {},
      { retryLimit: 3, retryDelay: 30, retryBackoff: true },
    );
    await this.boss.send(
      JOB_QUEUES.maintenance,
      {},
      { singletonKey: "startup", singletonSeconds: 60 },
    );
    if (this.dependencies.dashboards) {
      await this.boss.work(JOB_QUEUES.dashboardPrerender, async () => {
        await this.prerenderDashboards();
      });
      // Hourly, matching the render cache's validity, and once at startup so a fresh
      // process serves complete results without waiting for the first tick.
      await this.boss.schedule(
        JOB_QUEUES.dashboardPrerender,
        "0 * * * *",
        {},
        { retryLimit: 1, retryDelay: 60, expireInSeconds: 3000 },
      );
      await this.boss.send(
        JOB_QUEUES.dashboardPrerender,
        {},
        { singletonKey: "startup", singletonSeconds: 60 },
      );
    }
  }

  async stop(): Promise<void> {
    await this.boss.stop({ graceful: true, timeout: 30_000, wait: true });
  }

  async rescan(
    tx: Prisma.TransactionClient,
    context: ServiceContext,
    input: z.infer<typeof redactionRescanInputSchema>,
  ): Promise<string> {
    const caller = requirePermission(context, "admin");
    const id = uuidv7();
    await tx.redactionRun.create({
      data: { organizationId: caller.organizationId, id, totalSessions: 0 },
    });
    const total =
      await tx.$executeRaw`INSERT INTO redaction_run_session(organization_id,run_id,session_id)
      SELECT organization_id,${id}::uuid,id FROM trace_session_control s
      WHERE organization_id=${caller.organizationId} AND purged_at IS NULL
        AND (${input.since ?? null}::timestamptz IS NULL OR EXISTS (
          SELECT 1 FROM trace_receipt b WHERE b.organization_id=s.organization_id AND b.session_id=s.id AND b.received_at>=${input.since ?? null}::timestamptz))`;
    await tx.redactionRun.update({
      where: {
        organizationId_id: { organizationId: caller.organizationId, id },
      },
      data: { totalSessions: total },
    });
    const data = traceRescanPayloadSchema.parse({
      organizationId: caller.organizationId,
      runId: id,
      caller,
      requestId: context.requestId,
      input,
    });
    await this.enqueueRescan(tx, data, id);
    return id;
  }

  private async enqueueRescan(
    tx: Prisma.TransactionClient,
    data: RescanJob,
    id?: string,
  ): Promise<void> {
    const result = await this.boss.send(JOB_QUEUES.rescan, data, {
      ...(id ? { id } : {}),
      db: prismaJobDatabase(tx),
      retryLimit: 5,
      retryDelay: 5,
      retryBackoff: true,
      expireInSeconds: 180,
    });
    if (!result) throw new Error("The rescan job could not be persisted.");
  }

  progress(context: ServiceContext, id: string) {
    return readOperation(
      this.dependencies.audit,
      context,
      {
        action: "redaction.rescan.progress",
        resourceType: "redaction_run",
        resourceIds: [id],
      },
      async (caller) => {
        sessionIdSchema.parse(id);
        const run = await this.dependencies.prisma.redactionRun.findUnique({
          where: {
            organizationId_id: { organizationId: caller.organizationId, id },
          },
        });
        if (!run)
          throw new ServiceError(404, "NOT_FOUND", "The rescan was not found.");
        return jobProgressSchema.parse({
          job_id: run.id,
          state: run.state,
          total_sessions: run.totalSessions,
          processed_sessions: run.processedSessions,
          redaction_count: run.redactionCount,
          error: run.error,
        });
      },
      {
        permission: "admin",
      },
    );
  }

  async status(organizationId: string) {
    const counts = await this.dependencies.prisma.$queryRaw<
      { queue_depth: number; embedding_backlog: number }[]
    >`
      SELECT count(*)::int AS queue_depth, count(*) FILTER (WHERE name=${JOB_QUEUES.embedding})::int AS embedding_backlog
      FROM pgboss.job WHERE state IN ('created','retry','active') AND data->>'organizationId'=${organizationId}`;
    const usage = this.dependencies.embeddings
      ? await this.dependencies.embeddings.budget.status(organizationId)
      : { embedding_daily_tokens: "0", embedding_daily_cost: "0" };
    return {
      queue_depth: counts[0]?.queue_depth ?? 0,
      embedding_backlog: counts[0]?.embedding_backlog ?? 0,
      ...usage,
    };
  }

  private jobContext(data: RescanJob): ServiceContext {
    return {
      ...operatorContext(),
      requestId: data.requestId,
      caller: data.caller,
      userAgent: "agentcommons rescan worker",
    };
  }

  /** Each target has one durable ordered generation boundary; publication owns its progress checkpoint. */
  private async processRescan(data: RescanJob): Promise<void> {
    if (data.organizationId !== data.caller.organizationId)
      throw new ServiceError(403, "JOB_SCOPE", "The rescan scope is invalid.");
    const target = await this.dependencies.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM redaction_run WHERE organization_id=${data.organizationId} AND id=${data.runId}::uuid FOR UPDATE`;
      const run = await tx.redactionRun.findUnique({
        where: {
          organizationId_id: {
            organizationId: data.organizationId,
            id: data.runId,
          },
        },
      });
      if (!run || run.state === "completed" || run.state === "failed")
        return null;
      const context = await reauthorizeJob(
        tx,
        this.jobContext(data),
        this.dependencies.authConfiguration,
      );
      await lockOrganization(tx, requirePermission(context, "admin"));
      const target = await tx.redactionRunSession.findFirst({
        where: {
          organizationId: data.organizationId,
          runId: data.runId,
          processedAt: null,
        },
        orderBy: { sessionId: "asc" },
      });
      if (!target) {
        await tx.redactionRun.update({
          where: {
            organizationId_id: {
              organizationId: data.organizationId,
              id: data.runId,
            },
          },
          data: { state: "completed", error: null },
        });
        return null;
      }
      if (
        !(await lockTraceSessionControl(
          tx,
          data.organizationId,
          target.sessionId,
        ))
      )
        throw new ServiceError(404, "NOT_FOUND", "Session not found.");
      const control = await tx.traceSessionControl.findUniqueOrThrow({
        where: {
          organizationId_id: {
            organizationId: data.organizationId,
            id: target.sessionId,
          },
        },
      });
      if (control.purgedAt) {
        // A purged session has nothing left to rescan: processed, with no hits.
        await completeRunSession(
          tx,
          data.organizationId,
          data.runId,
          target.sessionId,
          0,
        );
      } else {
        const pending = await tx.traceOutbox.findFirst({
          where: {
            organizationId: data.organizationId,
            sessionId: target.sessionId,
            kind: "rescan",
            payload: { path: ["runId"], equals: data.runId },
          },
        });
        if (!pending) {
          const id = uuidv7();
          const revision = control.acceptedRevision + 1n;
          await tx.traceOutbox.create({
            data: {
              id,
              organizationId: data.organizationId,
              sessionId: target.sessionId,
              revision,
              kind: "rescan",
              payload: traceRescanPayloadSchema.parse(data),
            },
          });
          await tx.traceSessionControl.update({
            where: {
              organizationId_id: {
                organizationId: data.organizationId,
                id: target.sessionId,
              },
            },
            data: {
              acceptedRevision: revision,
              projectionState: "queued",
              projectionError: null,
            },
          });
          await this.enqueue(tx, {
            organizationId: data.organizationId,
            sessionId: target.sessionId,
            outboxId: id,
          });
        }
      }
      await this.dependencies.audit.write(
        context,
        {
          action: control.purgedAt
            ? "redaction.rescan.session"
            : "redaction.rescan.queued",
          resourceType: "session",
          resourceIds: [target.sessionId],
          detail: {
            run_id: data.runId,
            reason: data.input.reason,
            queued: !control.purgedAt,
            purged: control.purgedAt !== null,
          },
        },
        tx,
      );
      return target;
    });
    if (!target) return;
    await this.dependencies.traces.process(
      data.organizationId,
      target.sessionId,
    );
    await this.dependencies.prisma.$transaction(async (tx) => {
      const current = await tx.redactionRunSession.findUniqueOrThrow({
        where: {
          organizationId_runId_sessionId: {
            organizationId: data.organizationId,
            runId: data.runId,
            sessionId: target.sessionId,
          },
        },
      });
      if (!current.processedAt)
        throw new Error("The ordered rescan projection is still pending.");
      const run = await tx.redactionRun.findUniqueOrThrow({
        where: {
          organizationId_id: {
            organizationId: data.organizationId,
            id: data.runId,
          },
        },
      });
      if (run.state !== "completed") await this.enqueueRescan(tx, data);
      await this.dependencies.audit.write(
        operatorContext(),
        {
          action: "redaction.rescan.advance",
          resourceType: "redaction_run",
          resourceIds: [run.id],
          actor: workerActor(data.organizationId),
          detail: { processed_sessions: run.processedSessions },
        },
        tx,
      );
    });
  }

  async schedule(
    tx: Prisma.TransactionClient,
    data: EmbeddingJob,
  ): Promise<void> {
    if (
      this.dependencies.embeddings &&
      (
        await organizationEmbeddingSetting(
          tx,
          data.organizationId,
          false,
          this.saas,
        )
      ).enabled
    )
      await this.enqueueEmbedding(data, tx);
  }
  private async enqueueEmbedding(
    data: EmbeddingJob,
    tx: Prisma.TransactionClient,
    startAfter?: Date,
  ): Promise<void> {
    const id = await this.boss.send(JOB_QUEUES.embedding, data, {
      db: prismaJobDatabase(tx),
      ...(startAfter ? { startAfter } : {}),
      retryLimit: 5,
      retryDelay: 30,
      retryBackoff: true,
      expireInSeconds: 180,
    });
    if (!id) throw new Error("The embedding job could not be persisted.");
  }
  async catchupOrganization(
    tx: Prisma.TransactionClient,
    organizationId: string,
  ): Promise<void> {
    const id = await this.boss.send(
      JOB_QUEUES.embeddingCatchup,
      { organizationId },
      {
        db: prismaJobDatabase(tx),
        retryLimit: 5,
        retryDelay: 30,
        retryBackoff: true,
      },
    );
    if (!id) throw new Error("Embedding catch-up could not be queued.");
  }
  private async catchupEmbeddings(organizationId?: string): Promise<void> {
    const enabled =
      await this.dependencies.prisma.organizationSettings.findMany({
        where: {
          embeddingsEnabled: true,
          ...(organizationId ? { organizationId } : {}),
        },
        select: { organizationId: true },
      });
    if (!enabled.length) return;
    let after: string | undefined;
    for (;;) {
      const sessions =
        await this.dependencies.prisma.traceSessionControl.findMany({
          where: {
            organizationId: {
              in: enabled.map((setting) => setting.organizationId),
            },
            purgedAt: null,
            publishedRevision: { gt: 0n },
            ...(after ? { id: { gt: after } } : {}),
            OR: [
              { embeddingState: null },
              { embeddingState: { complete: false } },
            ],
          },
          select: { id: true, organizationId: true },
          orderBy: { id: "asc" },
          take: 100,
        });
      if (!sessions.length) break;
      const pending = await this.dependencies.prisma.$queryRaw<
        { session_id: string }[]
      >`SELECT DISTINCT data->>'sessionId' AS session_id FROM pgboss.job WHERE name=${JOB_QUEUES.embedding} AND state IN ('created','retry','active') AND data->>'sessionId'=ANY(${sessions.map((session) => session.id)}::text[])`;
      const queued = new Set(pending.map((row) => row.session_id));
      for (const session of sessions) {
        if (queued.has(session.id)) continue;
        await this.dependencies.prisma.$transaction(async (tx) => {
          if (
            !(
              await organizationEmbeddingSetting(
                tx,
                session.organizationId,
                false,
                this.saas,
              )
            ).enabled
          )
            return;
          // Native singleton handling closes the race between concurrent catch-up scans.
          const id = await this.boss.send(
            JOB_QUEUES.embedding,
            { organizationId: session.organizationId, sessionId: session.id },
            {
              db: prismaJobDatabase(tx),
              singletonKey: session.id,
              singletonSeconds: 600,
              retryLimit: 5,
              retryDelay: 30,
              retryBackoff: true,
              expireInSeconds: 180,
            },
          );
          if (id)
            await this.dependencies.audit.write(
              operatorContext(),
              {
                action: "embeddings.catchup",
                resourceType: "session",
                resourceIds: [session.id],
                actor: workerActor(session.organizationId),
                detail: { job_id: id },
              },
              tx,
            );
        });
      }
      after = sessions.at(-1)?.id;
    }
  }
  /**
   * Pre-render the default and saved dashboards of every organization for each caller
   * scope that rendered a dashboard in the last seven days, as recorded by its
   * `dashboard.render` audit rows (§10). Each scope's membership and key are re-checked
   * first; a scope that lost access is skipped and audited as such. One organization's
   * failure never stops the run.
   */
  async prerenderDashboards(now = new Date()): Promise<void> {
    const { dashboards, prisma, audit } = this.dependencies;
    if (!dashboards) return;
    const viewers = await prisma.auditEvent.groupBy({
      by: ["organizationId", "userId", "apiKeyId"],
      where: {
        action: "dashboard.render",
        statusCode: 200,
        ts: {
          gte: new Date(now.getTime() - PRERENDER_WINDOW_DAYS * 86_400_000),
        },
        organizationId: { not: null },
        userId: { not: null },
      },
      _max: { ts: true },
      orderBy: [{ organizationId: "asc" }, { _max: { ts: "desc" } }],
    });
    const rendered = new Map<string, Set<string>>();
    for (const viewer of viewers) {
      const { organizationId, userId, apiKeyId } = viewer;
      if (organizationId === null || userId === null) continue;
      const scopes = rendered.get(organizationId) ?? new Set<string>();
      rendered.set(organizationId, scopes);
      if (scopes.size >= PRERENDER_SCOPES_PER_ORGANIZATION) continue;
      const actor = workerActor(organizationId);
      try {
        const caller = await this.viewerCaller({
          organizationId,
          userId,
          apiKeyId,
        });
        const scope = renderScope(caller);
        if (scopes.has(scope)) continue;
        scopes.add(scope);
        const summary = await dashboards.prerender(caller);
        await audit.write(operatorContext(), {
          action: "dashboard.prerender",
          resourceType: "dashboard",
          resourceIds: summary.dashboards,
          actor,
          detail: {
            scope,
            user_id: userId,
            api_key_id: apiKeyId,
            dashboards: summary.dashboards.length,
            tiles: summary.tiles,
            errors: summary.errors,
          },
        });
      } catch (error) {
        if (error instanceof ServiceError && error.statusCode === 403) {
          await audit.write(operatorContext(), {
            action: "dashboard.prerender",
            statusCode: 403,
            resourceType: "dashboard",
            actor,
            detail: {
              user_id: userId,
              api_key_id: apiKeyId,
              skipped: error.code,
            },
          });
          continue;
        }
        this.dependencies.onError(
          new Error("A dashboard pre-render failed; the next run retries it.", {
            cause: error,
          }),
        );
      }
    }
  }
  /** The current authority of a caller seen in the audit log, or 403 when it lapsed. */
  private async viewerCaller(viewer: {
    organizationId: string;
    userId: string;
    apiKeyId: string | null;
  }): Promise<CallerContext> {
    const context = await reauthorizeJob(
      this.dependencies.prisma,
      {
        ...operatorContext(),
        caller: callerContextSchema.parse({
          ...viewer,
          // Placeholders: re-authorization reads the membership role and key permissions.
          role: "member",
          authMethod: viewer.apiKeyId === null ? "cookie" : "key",
          permissions: {},
        }),
      },
      this.dependencies.authConfiguration,
    );
    const caller = requirePermission(context, "read");
    return caller.authMethod === "cookie"
      ? cookieCaller({ ...viewer, role: caller.role })
      : caller;
  }
  async maintenance(now = new Date()): Promise<void> {
    await this.recoverTraceOutboxes();
    if (this.dependencies.embeddings) await this.catchupEmbeddings();
    const cutoff = new Date(
      now.getTime() - this.dependencies.auditRetentionDays * 86_400_000,
    );
    const inactive = new Date(now.getTime() - 6 * 3_600_000);
    await this.dependencies.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`UPDATE trace_analytics_retention SET retained_after=GREATEST(retained_after,${cutoff}) WHERE id=1`;
      const removed = await tx.auditEvent.deleteMany({
        where: { ts: { lt: cutoff } },
      });
      await tx.redactionRun.deleteMany({
        where: {
          state: { in: ["completed", "failed"] },
          updatedAt: { lt: cutoff },
        },
      });
      await this.dependencies.audit.write(
        operatorContext(),
        {
          action: "audit.retention",
          detail: {
            removed: removed.count,
            retention_days: this.dependencies.auditRetentionDays,
          },
        },
        tx,
      );
    });
    let after: string | undefined;
    for (;;) {
      const organizations =
        await this.dependencies.prisma.organization.findMany({
          where: after ? { id: { gt: after } } : {},
          orderBy: { id: "asc" },
          take: 100,
          select: { id: true },
        });
      if (!organizations.length) break;
      for (const organization of organizations)
        await this.dependencies.prisma.$transaction(async (tx) => {
          await lockTracePublication(tx, organization.id, "write");
          const changed = await tx.traceSessionControl.updateMany({
            where: {
              organizationId: organization.id,
              status: "ACTIVE",
              purgedAt: null,
              lastActivityAt: { lt: inactive },
            },
            data: { status: "INACTIVE" },
          });
          if (changed.count)
            await this.dependencies.audit.write(
              operatorContext(),
              {
                action: "sessions.inactive",
                resourceType: "session",
                actor: workerActor(organization.id),
                detail: { count: changed.count },
              },
              tx,
            );
        });
      after = organizations.at(-1)?.id;
    }
  }
}
