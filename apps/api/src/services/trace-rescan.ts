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
import type { Prisma, TraceSessionControl } from "@agentcommons/db";
import type { TraceRawRecord, TraceSession } from "@agentcommons/traces";

export const traceRescanPayloadSchema = z.strictObject({
  organizationId: z.string().min(1),
  runId: z.uuid(),
  caller: callerContextSchema,
  requestId: z.string(),
  input: redactionRescanInputSchema,
});

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
