import PgBoss from "pg-boss";
import {
  embeddingJobSchema,
  type EmbeddingJob,
  type EmbeddingService,
} from "../embeddings/service.js";
import { z } from "zod";
import { v7 as uuidv7 } from "uuid";
import { JOB_QUEUES, Prisma, type PrismaClient } from "@agentcommons/db";
import {
  callerContextSchema,
  canonicalIdentity,
  jobProgressSchema,
  jsonObjectSchema,
  maskToolResults,
  normalizerContextSchema,
  redactNormalizerContext,
  redactObservedCommits,
  NORMALIZERS,
  redactSourceRecord,
  redactionRescanInputSchema,
  sanitizeSourceRecord,
  sessionIdSchema,
  type PolicyCache,
  type RedactionCount,
  type RedactionResult,
  type SourceRecord,
} from "@agentcommons/core";
import { reauthorizeJob } from "../auth/jobs.js";
import { operatorContext } from "../auth/bootstrap.js";
import { lockOrganization } from "./auth.js";
import type { AuditService } from "./audit.js";
import { readOperation } from "./read-operation.js";
import {
  requirePermission,
  ServiceError,
  type ServiceContext,
} from "./context.js";
import { projectSession, sourceRecord } from "./projection.js";
import type { AdminJobs } from "./admin.js";
import { persistRedactionCounts } from "./policies.js";

const rescanJobSchema = z.strictObject({
  organizationId: z.string().min(1),
  runId: sessionIdSchema,
  caller: callerContextSchema,
  requestId: z.string(),
  input: redactionRescanInputSchema,
});
type RescanJob = z.infer<typeof rescanJobSchema>;
interface Dependencies {
  prisma: PrismaClient;
  audit: AuditService;
  policies: PolicyCache;
  connectionString: string;
  auditRetentionDays: number;
  allowedEmailDomains: readonly string[];
  onError: (error: Error) => void;
  embeddings?: EmbeddingService;
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
  constructor(private readonly dependencies: Dependencies) {
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

  async start(): Promise<void> {
    await this.boss.start();
    if (this.dependencies.embeddings) {
      await this.dependencies.embeddings.initialize();
      await this.boss.work<unknown>(JOB_QUEUES.embedding, async (jobs) => {
        for (const job of jobs) {
          const data = embeddingJobSchema.parse(job.data);
          const result = await this.dependencies.embeddings?.process(data);
          if (result && !result.complete)
            await this.enqueueEmbedding(
              data,
              undefined,
              result.deferredUntil ?? undefined,
            );
        }
      });
      await this.catchupEmbeddings();
    }
    await this.boss.work<unknown>(
      JOB_QUEUES.rescan,
      { includeMetadata: true },
      async (jobs) => {
        for (const job of jobs) {
          const data = rescanJobSchema.parse(job.data);
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
      SELECT organization_id,${id}::uuid,id FROM agent_session s
      WHERE organization_id=${caller.organizationId} AND purged_at IS NULL
        AND (${input.since ?? null}::timestamptz IS NULL OR EXISTS (
          SELECT 1 FROM ingest_batch b WHERE b.organization_id=s.organization_id AND b.session_id=s.id AND b.received_at>=${input.since ?? null}::timestamptz))`;
    await tx.redactionRun.update({
      where: {
        organizationId_id: { organizationId: caller.organizationId, id },
      },
      data: { totalSessions: total },
    });
    const data = rescanJobSchema.parse({
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
      undefined,
      "admin",
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

  /** One bounded queue delivery processes one target; the next delivery commits with it. */
  private async processRescan(data: RescanJob): Promise<void> {
    if (data.organizationId !== data.caller.organizationId)
      throw new ServiceError(403, "JOB_SCOPE", "The rescan scope is invalid.");
    await this.dependencies.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM redaction_run WHERE organization_id=${data.organizationId} AND id=${data.runId}::uuid FOR UPDATE`;
        const run = await tx.redactionRun.findUnique({
          where: {
            organizationId_id: {
              organizationId: data.organizationId,
              id: data.runId,
            },
          },
        });
        if (!run || run.state === "completed" || run.state === "failed") return;
        const context = await reauthorizeJob(
          tx,
          this.jobContext(data),
          this.dependencies.allowedEmailDomains,
        );
        const caller = requirePermission(context, "admin");
        await lockOrganization(tx, caller);
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
          return;
        }
        await tx.$queryRaw`SELECT id FROM agent_session WHERE organization_id=${data.organizationId} AND id=${target.sessionId}::uuid FOR UPDATE`;
        let session = await tx.agentSession.findUniqueOrThrow({
          where: {
            organizationId_id: {
              organizationId: data.organizationId,
              id: target.sessionId,
            },
          },
        });
        let count = 0;
        if (!session.purgedAt) {
          this.dependencies.policies.invalidate(data.organizationId);
          const redactor = await this.dependencies.policies.get(
            data.organizationId,
          );
          const stored = await tx.rawRecord.findMany({
            where: {
              organizationId: data.organizationId,
              sessionId: session.id,
            },
            orderBy: [{ pos: "asc" }, { sourceVersion: "asc" }],
          });
          const records: SourceRecord[] = [];
          const batchByRecord = new Map(
            stored.map((row) => [row.id, row.ingestBatchId]),
          );
          const hits = new Map<
            string,
            { batchId: string; count: RedactionCount }
          >();
          const addCounts = (
            batchId: string,
            counts: readonly RedactionCount[],
          ) => {
            for (const hit of counts) {
              count += hit.count;
              const key = `${batchId}:${hit.policyId}`;
              const previous = hits.get(key);
              if (previous) previous.count.count += hit.count;
              else hits.set(key, { batchId, count: { ...hit } });
            }
          };
          for (const record of maskToolResults(
            NORMALIZERS[session.harness],
            stored.map(sourceRecord),
          )) {
            const redacted = await redactSourceRecord(
              NORMALIZERS[session.harness],
              record,
              redactor,
            );
            const key =
              record.key === null
                ? null
                : await canonicalIdentity(record.key, redactor);
            const rewritten = sanitizeSourceRecord({
              ...redacted.value,
              key: key?.value ?? null,
            });
            const payload = jsonObjectSchema.parse(rewritten.payload);
            records.push(rewritten);
            await tx.rawRecord.update({
              where: { id: record.id },
              data: {
                payload,
                key: rewritten.key,
                redactionContext: rewritten.redactionContext ?? {},
              },
            });
            const batchId = batchByRecord.get(record.id);
            if (!batchId)
              throw new Error("The rescan source receipt is missing.");
            addCounts(batchId, redacted.counts);
            if (key) addCounts(batchId, key.counts);
          }
          // Envelope observations have no transcript equivalent; rescan them as well.
          const metadataCounts: RedactionCount[] = [];
          const collect = <T>(result: RedactionResult<T>): T => {
            metadataCounts.push(...result.counts);
            return result.value;
          };
          const text = async (value: string | null) =>
            value === null ? null : collect(await redactor.text(value));
          const identity = async (value: string | null) =>
            value === null
              ? null
              : collect(await canonicalIdentity(value, redactor));
          const contextFields = async (value: unknown) =>
            collect(
              await redactNormalizerContext(
                normalizerContextSchema.parse(value),
                redactor,
              ),
            );
          const installation = await tx.installation.findUniqueOrThrow({
            where: {
              organizationId_id: {
                organizationId: data.organizationId,
                id: session.installationId,
              },
            },
          });
          await tx.installation.update({
            where: {
              organizationId_id: {
                organizationId: data.organizationId,
                id: session.installationId,
              },
            },
            data: {
              hostname: (await text(installation.hostname)) ?? "",
              osUser: (await text(installation.osUser)) ?? "",
              platform: (await text(installation.platform)) ?? "",
              arch: (await text(installation.arch)) ?? "",
            },
          });
          session = await tx.agentSession.update({
            where: { id: session.id },
            data: {
              harnessSessionId:
                (await identity(session.harnessSessionId)) ?? "",
              parentNativeRef: await identity(session.parentNativeRef),
              normalizerContext: await contextFields(session.normalizerContext),
              projectedContext: await contextFields(session.projectedContext),
              cwd: (await text(session.cwd)) ?? "",
              repoRoot: await text(session.repoRoot),
              cwdRelative: await text(session.cwdRelative),
              repoUrl: await text(session.repoUrl),
              repoName: await text(session.repoName),
              branch: await text(session.branch),
              startCommit: await text(session.startCommit),
              endCommit: await text(session.endCommit),
              endReason: await text(session.endReason),
              harnessVersion: await text(session.harnessVersion),
              entrypoint: await text(session.entrypoint),
              agentType: await text(session.agentType),
              observedCommits:
                session.observedCommits === null
                  ? Prisma.DbNull
                  : collect(
                      await redactObservedCommits(
                        session.observedCommits,
                        redactor,
                      ),
                    ),
              observedDiffStat:
                session.observedDiffStat === null
                  ? Prisma.DbNull
                  : (collect(await redactor.json(session.observedDiffStat)) ??
                    Prisma.JsonNull),
            },
          });
          await projectSession(tx, session, records, { rescan: true });
          await this.schedule(tx, {
            organizationId: data.organizationId,
            sessionId: session.id,
          });
          if (metadataCounts.length) {
            const receipt = await tx.ingestBatch.findFirstOrThrow({
              where: {
                organizationId: data.organizationId,
                sessionId: session.id,
              },
              orderBy: { receivedAt: "desc" },
            });
            addCounts(receipt.id, metadataCounts);
          }
          for (const { batchId, count: hit } of hits.values())
            await persistRedactionCounts(
              tx,
              data.organizationId,
              batchId,
              session.id,
              [hit],
            );
        }
        await this.dependencies.audit.write(
          context,
          {
            action: "redaction.rescan.session",
            resourceType: "session",
            resourceIds: [session.id],
            detail: {
              run_id: run.id,
              reason: data.input.reason,
              policy_ids: data.input.policyIds ?? [],
              redaction_count: count,
              purged: session.purgedAt !== null,
            },
          },
          tx,
        );
        await tx.redactionRunSession.update({
          where: {
            organizationId_runId_sessionId: {
              organizationId: data.organizationId,
              runId: data.runId,
              sessionId: session.id,
            },
          },
          data: { processedAt: new Date() },
        });
        const complete = run.processedSessions + 1 === run.totalSessions;
        await tx.redactionRun.update({
          where: {
            organizationId_id: {
              organizationId: data.organizationId,
              id: data.runId,
            },
          },
          data: {
            processedSessions: { increment: 1 },
            redactionCount: { increment: count },
            state: complete ? "completed" : "running",
            error: null,
          },
        });
        if (!complete) await this.enqueueRescan(tx, data);
      },
      { timeout: 120_000, maxWait: 30_000 },
    );
  }

  async schedule(
    tx: Prisma.TransactionClient,
    data: EmbeddingJob,
  ): Promise<void> {
    if (this.dependencies.embeddings) await this.enqueueEmbedding(data, tx);
  }
  private async enqueueEmbedding(
    data: EmbeddingJob,
    tx?: Prisma.TransactionClient,
    startAfter?: Date,
  ): Promise<void> {
    if (!tx) {
      await this.dependencies.prisma.$transaction(async (transaction) => {
        await this.enqueueEmbedding(data, transaction, startAfter);
        await this.dependencies.audit.write(
          operatorContext(),
          {
            action: "embeddings.schedule",
            resourceType: "session",
            resourceIds: [data.sessionId],
            actor: {
              organizationId: data.organizationId,
              userId: null,
              apiKeyId: null,
              authMethod: "worker",
            },
            detail: { deferred_until: startAfter?.toISOString() ?? null },
          },
          transaction,
        );
      });
      return;
    }
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
  private async catchupEmbeddings(): Promise<void> {
    let after: string | undefined;
    for (;;) {
      const sessions = await this.dependencies.prisma.agentSession.findMany({
        where: {
          purgedAt: null,
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
                actor: {
                  organizationId: session.organizationId,
                  userId: null,
                  apiKeyId: null,
                  authMethod: "worker",
                },
                detail: { job_id: id },
              },
              tx,
            );
        });
      }
      after = sessions.at(-1)?.id;
    }
  }
  async maintenance(now = new Date()): Promise<void> {
    if (this.dependencies.embeddings) await this.catchupEmbeddings();
    const cutoff = new Date(
      now.getTime() - this.dependencies.auditRetentionDays * 86_400_000,
    );
    const inactive = new Date(now.getTime() - 6 * 3_600_000);
    await this.dependencies.prisma.$transaction(async (tx) => {
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
          const changed = await tx.agentSession.updateMany({
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
                actor: {
                  organizationId: organization.id,
                  userId: null,
                  apiKeyId: null,
                  authMethod: "worker",
                },
                detail: { count: changed.count },
              },
              tx,
            );
        });
      after = organizations.at(-1)?.id;
    }
  }
}
