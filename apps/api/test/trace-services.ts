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
  });
  const jobs: JobService = new JobService({
    prisma,
    audit,
    traces: projection,
    traceAudit,
    connectionString: db.urls.app,
    ...(options.embeddings ? { embeddings: options.embeddings } : {}),
    allowedEmailDomains: [],
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
  async function publish(context: ServiceContext, input: unknown) {
    const accepted = await ingest.execute(context, input);
    await projection.process(
      requireCaller(context).organizationId,
      accepted.result.sessionId,
    );
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
    traceAudit,
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
