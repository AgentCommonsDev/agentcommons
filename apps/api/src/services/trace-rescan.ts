import { z } from "zod";
import {
  callerContextSchema,
  canonicalIdentity,
  maskToolResults,
  NORMALIZERS,
  normalizerContextSchema,
  redactNormalizerContext,
  redactObservedCommits,
  redactSourceRecord,
  redactionRescanInputSchema,
  sanitizeSourceRecord,
  type RedactionCount,
  type RedactionResult,
  type Redactor,
} from "@agentcommons/core";
import type {
  Prisma,
  PrismaClient,
  TraceSessionControl,
} from "@agentcommons/db";
import type { TraceRawRecord, TraceSession } from "@agentcommons/traces";
import { setTimeout as delay } from "node:timers/promises";

export const traceRescanPayloadSchema = z.strictObject({
  organizationId: z.string().min(1),
  runId: z.uuid(),
  caller: callerContextSchema,
  requestId: z.string(),
  input: redactionRescanInputSchema,
});

/**
 * Targets one rescan job publishes at a time (ADR 0066). Their ClickHouse reads and inserts
 * overlap; only the claim step is serialized on the organization row, and each target still
 * commits its own rewrite, counters, audit and checkpoint.
 */
export const RESCAN_CONCURRENCY = 3;
/** A job hands over to its successor after this long, well inside pg-boss's 180 s job expiry. */
export const RESCAN_JOB_BUDGET_MS = 60_000;

/**
 * Waits for claimed targets whose checkpoint another publisher is about to commit (the
 * projection worker races the rescan job for the same outbox row) and returns the session
 * ids still unprocessed once no projection lease is outstanding or the timeout passes.
 */
export async function awaitRescanCheckpoints(
  prisma: PrismaClient,
  organizationId: string,
  runId: string,
  sessionIds: readonly string[],
  timeoutMs = 15_000,
): Promise<string[]> {
  const deadline = Date.now() + timeoutMs;
  let pending = [...sessionIds];
  for (;;) {
    const processed = await prisma.redactionRunSession.findMany({
      where: {
        organizationId,
        runId,
        sessionId: { in: pending },
        processedAt: { not: null },
      },
      select: { sessionId: true },
    });
    const done = new Set(processed.map((row) => row.sessionId));
    pending = pending.filter((sessionId) => !done.has(sessionId));
    if (!pending.length) return pending;
    const leased = await prisma.traceSessionControl.count({
      where: {
        organizationId,
        id: { in: pending },
        projectionLeaseUntil: { gt: new Date() },
      },
    });
    if (!leased || Date.now() >= deadline) return pending;
    await delay(100);
  }
}

/**
 * Marks one session of a redaction run processed and advances the run, which completes
 * once its last session is counted. The publisher and the skipped-session path share it.
 */
export async function completeRunSession(
  tx: Prisma.TransactionClient,
  organizationId: string,
  runId: string,
  sessionId: string,
  redactionCount: number,
): Promise<void> {
  const where = { organizationId_id: { organizationId, id: runId } };
  await tx.redactionRunSession.update({
    where: {
      organizationId_runId_sessionId: { organizationId, runId, sessionId },
    },
    data: { processedAt: new Date() },
  });
  const run = await tx.redactionRun.update({
    where,
    data: {
      processedSessions: { increment: 1 },
      redactionCount: { increment: redactionCount },
      error: null,
    },
  });
  await tx.redactionRun.update({
    where,
    data: {
      state:
        run.processedSessions === run.totalSessions ? "completed" : "running",
    },
  });
}

/** Reuses native record classification and schema-aware redaction for each storage generation. */
export async function redactTraceSnapshot(
  redactor: Redactor,
  control: TraceSessionControl,
  session: TraceSession,
  source: readonly TraceRawRecord[],
) {
  const counts = new Map<string, RedactionCount[]>();
  const metadataCounts: RedactionCount[] = [];
  const collect = <T>(result: RedactionResult<T>): T => {
    metadataCounts.push(...result.counts);
    return result.value;
  };
  const text = async (value: string | null) =>
    value === null ? null : collect(await redactor.text(value));
  const identity = async (value: string | null) =>
    value === null ? null : collect(await canonicalIdentity(value, redactor));
  const context = async (value: unknown) =>
    collect(
      await redactNormalizerContext(
        normalizerContextSchema.parse(value),
        redactor,
      ),
    );
  const originals = new Map(source.map((record) => [record.id, record]));
  const records: TraceRawRecord[] = [];
  const normalizer = NORMALIZERS[control.harness];
  for (const record of maskToolResults(normalizer, source)) {
    const original = originals.get(record.id);
    if (!original) throw new Error("Rescan record provenance is missing.");
    const redacted = await redactSourceRecord(normalizer, record, redactor);
    const key =
      record.key === null
        ? null
        : await canonicalIdentity(record.key, redactor);
    records.push({
      ...original,
      ...sanitizeSourceRecord({ ...redacted.value, key: key?.value ?? null }),
    });
    const hits = counts.get(original.ingestBatchId) ?? [];
    hits.push(...redacted.counts, ...(key?.counts ?? []));
    counts.set(original.ingestBatchId, hits);
  }
  const normalizerContext = await context(control.normalizerContext);
  const projectedContext = await context(control.projectedContext);
  const harnessSessionId = (await identity(control.harnessSessionId)) ?? "";
  const parentNativeRef = await identity(control.parentNativeRef);
  const header: TraceSession = {
    ...session,
    harness_session_id: harnessSessionId,
    parent_native_ref: parentNativeRef,
    cwd: (await text(session.cwd)) ?? "",
    repo_root: await text(session.repo_root),
    cwd_relative: await text(session.cwd_relative),
    repo_url: await text(session.repo_url),
    repo_name: await text(session.repo_name),
    branch: await text(session.branch),
    start_commit: await text(session.start_commit),
    end_commit: await text(session.end_commit),
    end_reason: await text(session.end_reason),
    harness_version: await text(session.harness_version),
    entrypoint: await text(session.entrypoint),
    agent_type: await text(session.agent_type),
    title: await text(session.title),
    first_prompt: await text(session.first_prompt),
    model: await text(session.model),
    models_used: await Promise.all(
      session.models_used.map(async (value) => (await text(value)) ?? ""),
    ),
    tools_used: await Promise.all(
      session.tools_used.map(async (value) => (await text(value)) ?? ""),
    ),
    observed_commits:
      session.observed_commits === null
        ? null
        : collect(
            await redactObservedCommits(session.observed_commits, redactor),
          ),
    observed_diff_stat:
      session.observed_diff_stat === null
        ? null
        : collect(await redactor.json(session.observed_diff_stat)),
  };
  return {
    records,
    header,
    counts,
    metadataCounts,
    control: {
      normalizerContext,
      projectedContext,
      harnessSessionId,
      parentNativeRef,
    },
  };
}
