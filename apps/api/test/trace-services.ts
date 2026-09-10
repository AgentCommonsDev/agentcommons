import { setTimeout as delay } from "node:timers/promises";
import { waitForTracePublication } from "../../../packages/traces/test/support.js";
import type { EmbeddingService } from "../src/embeddings/service.js";
import type { Prisma, PrismaClient } from "@agentcommons/db";
import type { TraceScope } from "@agentcommons/traces";
import type { startTraceDatabase } from "../../../packages/traces/test/support.js";
import { cleanup } from "../../../scripts/cleanup.js";
import { AuditService } from "../src/services/audit.js";
import type { ServiceContext } from "../src/services/context.js";
import { requireCaller } from "../src/services/context.js";
import { createPolicyCache } from "../src/services/policy-cache.js";
import { IngestService } from "../src/services/ingest.js";
import { JobService } from "../src/services/jobs.js";
import { TraceAuditProjectionService } from "../src/services/trace-audit-projection.js";
import { TraceProjectionService } from "../src/services/trace-projection.js";

/** Projects every committed audit row into ClickHouse before a test reads analytics. */
export async function drainTraceAudit(
  projection: TraceAuditProjectionService,
): Promise<void> {
  while (await projection.flush()) {
    /* Until the outbox is empty. */
  }
}

/** Polls a redaction run until it reaches `state`, failing with the run's last error otherwise. */
export async function waitForJob(
  jobs: JobService,
  context: ServiceContext,
  id: string,
  state: "completed" | "failed",
  timeoutMs = 20_000,
) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const progress = (await jobs.progress(context, id)).result;
    if (progress.state === state) return progress;
    if (Date.now() >= deadline)
      throw new Error(
        `Rescan remained ${progress.state}: ${progress.error ?? "no worker error"}`,
      );
    await delay(100);
  }
}

/** Real durable admission and native storage; publication is explicit in each test. */
export function traceServices(
  db: Awaited<ReturnType<typeof startTraceDatabase>>,
  application?: PrismaClient,
  options: { auditRetentionDays?: number; embeddings?: EmbeddingService } = {},
) {
  const prisma = application ?? db.prisma;
  const policies = application ? createPolicyCache(prisma) : db.policies;
  const audit = application ? new AuditService(prisma, policies) : db.audit;
  const projection: TraceProjectionService = new TraceProjectionService({
    prisma,
    audit,
    repository: db.traces,
    auth: db.authConfiguration,
    scheduleEmbeddings: (
      tx: Prisma.TransactionClient,
      data: { organizationId: string; sessionId: string },
    ): Promise<void> => jobs.schedule(tx, data),
  });
  const errors: Error[] = [];
  const traceAudit = new TraceAuditProjectionService({
    prisma,
    audit,
    traces: db.traces,
    readers: db.traceReaders,
  });
  const jobs: JobService = new JobService({
    prisma,
    audit,
    traces: projection,
    traceAudit,
    connectionString: db.urls.app,
    ...(options.embeddings ? { embeddings: options.embeddings } : {}),
    authConfiguration: db.authConfiguration,
    auditRetentionDays: options.auditRetentionDays ?? 365,
    onError: (error) => errors.push(error),
  });
  const ingest = new IngestService({ prisma, audit, traces: jobs });
  async function scope(
    organizationId: string,
    sessionId: string,
  ): Promise<TraceScope> {
    const row = await prisma.traceSessionControl.findUniqueOrThrow({
      where: { organizationId_id: { organizationId, id: sessionId } },
    });
    return {
      organizationId,
      sessionId,
      revision: row.publishedRevision,
      generation: row.redactionGeneration,
    };
  }
  async function header(organizationId: string, sessionId: string) {
    const current = await scope(organizationId, sessionId);
    const value = await db.traces.readSession(
      organizationId,
      sessionId,
      current.revision,
      current.generation,
    );
    if (!value) throw new Error("Expected published native header");
    return value;
  }
  async function raw(organizationId: string, sessionId: string) {
    const current = await scope(organizationId, sessionId);
    const items = [];
    let after: string | null = null;
    do {
      const page = await db.traces.rawPage(current, { after, limit: 1000 });
      items.push(...page.records);
      after = page.after;
    } while (after);
    return items;
  }
  async function messages(organizationId: string, sessionId: string) {
    const current = await scope(organizationId, sessionId);
    let after: string | null = null;
    const items = [];
    do {
      const page = await db.traces.messagesPage(current, {
        after,
        limit: 1000,
      });
      items.push(...page.items);
      after = page.after;
    } while (after);
    return items.sort((a, b) => a.seq - b.seq);
  }
  /** Admit and project once without waiting: for assertions on the state right after processing. */
  async function publishQueued(context: ServiceContext, input: unknown) {
    const accepted = await ingest.execute(context, input);
    await projection.process(
      requireCaller(context).organizationId,
      accepted.result.sessionId,
    );
    return accepted;
  }
  async function publish(context: ServiceContext, input: unknown) {
    const accepted = await publishQueued(context, input);
    await waitForTracePublication(prisma, [accepted.result.sessionId], {
      allowPurged: true,
    });
    return accepted;
  }
  return {
    prisma,
    policies,
    audit,
    projection,
    jobs,
    ingest,
    scope,
    header,
    raw,
    messages,
    publish,
    publishQueued,
    traceAudit,
    drainTraceAudit: () => drainTraceAudit(traceAudit),
    errors,
    async close() {
      const failures = await cleanup([() => jobs.stop()]);
      if (failures.length || errors.length)
        throw new AggregateError(
          [...failures, ...errors],
          "Trace test services failed to close cleanly.",
        );
    },
  };
}
