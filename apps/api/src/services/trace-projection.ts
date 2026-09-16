import {
  attributeRedactionHits,
  completeRunSession,
  redactTraceSnapshot,
  snapshotUnchanged,
  traceRescanPayloadSchema,
  type RecordedRedaction,
  type RedactionHitInput,
} from "./trace-rescan.js";
import { createPolicyCache } from "./policy-cache.js";
import { reauthorizeJob } from "../auth/jobs.js";
import type { IdentityPolicy } from "../auth/config.js";
import { requirePermission, ServiceError } from "./context.js";
import { persistRedactionCounts, persistRedactionHits } from "./policies.js";
import {
  persistToolPolicyViolations,
  projectToolPolicyViolations,
  type ProjectedViolation,
} from "./tool-policy.js";
import { posix } from "node:path";
import { v7 as uuidv7 } from "uuid";
import type { z } from "zod";
import {
  lockTracePublication,
  lockTraceSessionControl,
  lockTraceSink,
  type PrismaClient,
  type Prisma,
  type TraceOutbox,
  type TraceReceipt,
  type TraceSessionControl,
} from "@agentcommons/db";
import {
  projectTrace,
  purgeOutputSchema,
  normalizerContextSchema,
  repositoryIdentity,
  truncateUtf8,
  redactNormalizerContext,
  canonicalIdentity,
  toolPolicySchema,
  type IngestEnvelope,
  type Redactor,
} from "@agentcommons/core";
import {
  fingerprint,
  type TraceRepository,
  type TraceSession,
  type TraceMessageDelta,
  type TraceFileDelta,
  type TraceScope,
  type TraceRawRecord,
} from "@agentcommons/traces";
import type { AuditDescription, AuditService } from "./audit.js";
import { operatorContext, workerActor } from "../auth/bootstrap.js";
import { sourceFromOutbox, traceOutboxPayloadSchema } from "./trace-outbox.js";

type RescanPayload = z.infer<typeof traceRescanPayloadSchema>;
/** One reserved publication: the outbox rows it covers and the lease that fences its writes. */
interface Plan {
  organizationId: string;
  sessionId: string;
  control: TraceSessionControl;
  rescan: RescanPayload | null;
  redactor: Redactor | null;
  outboxes: TraceOutbox[];
  resumes: TraceReceipt[];
  receipts: Prisma.TraceReceiptGetPayload<{ include: { redactions: true } }>[];
  lease: string;
  revision: bigint;
}
/** What the sink now holds for a plan, awaiting the control-row commit that publishes it. */
interface Build {
  target: TraceScope;
  snapshot: TraceSession;
  rewritten: Awaited<ReturnType<typeof redactTraceSnapshot>> | null;
  projection: ReturnType<typeof projectTrace>;
  messages: TraceMessageDelta[];
  files: TraceFileDelta[];
  /** Where this plan's redactions landed, per message (§5.3); written with the control row. */
  hits: RedactionHitInput[];
  /**
   * Tool-policy matches derived from this projection (§9.7, ADR 0080), replacing the session's
   * projection-sourced violations on publish; null when no projection ran, so existing rows are
   * left untouched. `violationsEnforced` records whether the policy was enabled.
   */
  violations: ProjectedViolation[] | null;
  violationsEnforced: boolean;
}
/** Rows written to the sink per statement. */
const SINK_BATCH = 500;
/**
 * Superseded rows are reclaimed after a publish that changed rows when its revision is a
 * multiple of this, or when it changed more rows than the second bound (§5.2). The six
 * mutations scan the session's parts, so a busy session does not pay them on every
 * eight-second ingest.
 */
const SUPERSEDED_CLEANUP_EVERY_REVISIONS = 10n;
const SUPERSEDED_CLEANUP_ROWS = 1000;

/**
 * Serializes publication of one session: the publication fence, then its control row.
 * Publication changes no membership, admission or policy state, so it never takes the
 * organization row that ingest, membership and policy mutations serialize on (§5.2).
 */
async function lockSession(
  tx: Prisma.TransactionClient,
  organizationId: string,
  sessionId: string,
): Promise<void> {
  await lockTracePublication(tx, organizationId, "write");
  await lockTraceSessionControl(tx, organizationId, sessionId);
}
/** Reads every page of a keyset-paged repository read. */
async function drainPages<P extends { after: string | null }>(
  page: (after: string | null) => Promise<P>,
  consume: (value: P) => void,
): Promise<void> {
  let after: string | null = null;
  do {
    const value = await page(after);
    consume(value);
    after = value.after;
  } while (after);
}
export class TraceProjectionService {
  constructor(
    private readonly dependencies: {
      prisma: PrismaClient;
      audit: AuditService;
      repository: TraceRepository;
      /** Domain and instance policy the rescan initiator is re-checked against. */
      auth: IdentityPolicy;
      scheduleEmbeddings?: (
        tx: Prisma.TransactionClient,
        data: { organizationId: string; sessionId: string },
      ) => Promise<void>;
    },
  ) {}
  async process(organizationId: string, sessionId: string): Promise<void> {
    const control =
      await this.dependencies.prisma.traceSessionControl.findUnique({
        where: { organizationId_id: { organizationId, id: sessionId } },
      });
    if (control?.purgedAt) {
      if (!control.purgeCompletedAt)
        await this.completePurge(organizationId, sessionId);
      return;
    }
    await this.cleanupGenerations(organizationId, sessionId, control);
    const plan = await this.reserve(organizationId, sessionId);
    if (!plan) {
      await this.publishReceipts(organizationId, sessionId);
      return;
    }
    try {
      const build = await this.build(plan);
      if (!build) return;
      if (build === "unchanged") {
        await this.publishUnchanged(plan);
        // Receipts accepted since the last publish (empty syncs) still need appending.
        if (plan.receipts.some((receipt) => receipt.publishedAt === null))
          await this.publishReceipts(organizationId, sessionId);
        return;
      }
      await this.publish(plan, build);
      await this.cleanupSuperseded(plan, build);
      await this.cleanupGenerations(organizationId, sessionId);
    } catch (error) {
      await this.fail(plan, error);
    }
  }
  /** Audit one worker step on the organization's behalf, inside its transaction. */
  private audit(
    tx: Prisma.TransactionClient,
    organizationId: string,
    description: Omit<AuditDescription, "actor">,
  ) {
    return this.dependencies.audit.write(
      operatorContext(),
      { ...description, actor: workerActor(organizationId) },
      tx,
    );
  }
  /** The rescan's initiator must still hold admin authority when its work is reserved and when it publishes. */
  private async reauthorizeRescan(
    tx: Prisma.TransactionClient,
    rescan: RescanPayload,
  ): Promise<void> {
    const context = await reauthorizeJob(
      tx,
      {
        ...operatorContext(),
        caller: rescan.caller,
        requestId: rescan.requestId,
      },
      this.dependencies.auth,
    );
    requirePermission(context, "admin");
  }
  /** Physical cleanup of a purged session; a failure marks the row and rethrows so the job retries. */
  private async completePurge(
    organizationId: string,
    sessionId: string,
  ): Promise<void> {
    try {
      await this.purge(organizationId, sessionId);
    } catch (error) {
      await this.dependencies.prisma.$transaction(async (tx) => {
        await tx.traceSessionControl.update({
          where: { organizationId_id: { organizationId, id: sessionId } },
          data: {
            projectionState: "failed",
            projectionError:
              "Physical cleanup failed. The purge remains active and cleanup will retry.",
          },
        });
        await this.audit(tx, organizationId, {
          action: "session.purge.complete",
          statusCode: 503,
          resourceType: "session",
          resourceIds: [sessionId],
          detail: { failed: true, retained: true },
        });
      });
      throw new Error("Physical trace cleanup must retry.", { cause: error });
    }
  }
  /** Reserve the pending outbox rows up to the next rescan boundary under a lease, or nothing to do. */
  private reserve(
    organizationId: string,
    sessionId: string,
  ): Promise<Plan | null> {
    return this.dependencies.prisma.$transaction(async (tx) => {
      await lockSession(tx, organizationId, sessionId);
      const control = await tx.traceSessionControl.findUnique({
        where: { organizationId_id: { organizationId, id: sessionId } },
      });
      if (
        !control ||
        control.purgedAt ||
        control.acceptedRevision === control.publishedRevision ||
        (control.projectionLeaseUntil &&
          control.projectionLeaseUntil > new Date())
      )
        return null;
      const pending = await tx.traceOutbox.findMany({
        where: {
          organizationId,
          sessionId,
          revision: {
            gt: control.publishedRevision,
            lte: control.acceptedRevision,
          },
          kind: { in: ["ingest", "rescan"] },
        },
        orderBy: { revision: "asc" },
        take: 100,
      });
      const boundary = pending.findIndex((row) => row.kind === "rescan");
      const outboxes =
        boundary === 0
          ? pending.slice(0, 1)
          : boundary > 0
            ? pending.slice(0, boundary)
            : pending;
      const first = outboxes[0];
      if (!first) return null;
      const rescan =
        first.kind === "rescan"
          ? traceRescanPayloadSchema.parse(first.payload)
          : null;
      if (rescan) {
        if (rescan.organizationId !== organizationId)
          throw new Error("Rescan scope mismatch.");
        try {
          await this.reauthorizeRescan(tx, rescan);
        } catch (error) {
          if (!(error instanceof ServiceError) || error.statusCode !== 403)
            throw error;
          await tx.traceOutbox.delete({ where: { id: first.id } });
          await tx.traceSessionControl.update({
            where: { organizationId_id: { organizationId, id: sessionId } },
            data: {
              publishedRevision: first.revision,
              projectionState:
                control.acceptedRevision > first.revision
                  ? "queued"
                  : "published",
              projectionError: null,
            },
          });
          await tx.redactionRun.update({
            where: { organizationId_id: { organizationId, id: rescan.runId } },
            data: {
              state: "failed",
              error:
                "The initiating account no longer has permission to run this rescan.",
            },
          });
          await this.audit(tx, organizationId, {
            action: "redaction.rescan.cancelled",
            statusCode: 403,
            resourceType: "session",
            resourceIds: [sessionId],
            detail: { run_id: rescan.runId },
          });
          return null;
        }
      }
      const redactor = rescan
        ? await createPolicyCache(tx).get(organizationId)
        : null;
      const last = outboxes.at(-1) ?? first;
      const lease = uuidv7();
      await tx.traceSessionControl.update({
        where: { organizationId_id: { organizationId, id: sessionId } },
        data: {
          projectionLease: lease,
          projectionLeaseUntil: new Date(Date.now() + 120_000),
          projectionError: null,
          projectionState: "queued",
          projectionAttemptAt: new Date(),
        },
      });
      const resumes = await tx.traceReceipt.findMany({
        where: {
          organizationId,
          sessionId,
          revision: { lte: last.revision },
          startResume: true,
        },
        orderBy: [{ sourcePos: "asc" }, { sentAt: "asc" }, { id: "asc" }],
      });
      await this.audit(tx, organizationId, {
        action: "trace.reserve",
        resourceType: "session",
        resourceIds: [sessionId],
        detail: {
          revision: String(last.revision),
          outbox_batches: outboxes.length,
        },
      });
      // A rescan re-appends every receipt at the new generation; a publish appends the
      // ones not yet in ClickHouse, including empty receipts that created no revision.
      const receipts = await tx.traceReceipt.findMany({
        where: {
          organizationId,
          sessionId,
          revision: { lte: last.revision },
          ...(rescan ? {} : { publishedAt: null }),
        },
        include: { redactions: true },
      });
      return {
        organizationId,
        sessionId,
        control,
        rescan,
        redactor,
        outboxes,
        resumes,
        receipts,
        lease,
        revision: last.revision,
      };
    });
  }
  /**
   * Write the plan's raw records, projection and receipts to the sink under its lease.
   * Null when the lease was lost mid-way; the next reservation starts over. "unchanged"
   * when a rescan's re-redacted snapshot equals the published generation, before any
   * sink write (ADR 0066).
   */
  private async build(plan: Plan): Promise<Build | "unchanged" | null> {
    const { organizationId, sessionId } = plan;
    const { repository } = this.dependencies;
    const guarded = (operation: () => Promise<void>) =>
      this.write(organizationId, sessionId, plan.lease, operation);
    const published: TraceScope = {
      organizationId,
      sessionId,
      revision: plan.control.publishedRevision,
      generation: plan.control.redactionGeneration,
    };
    const target: TraceScope = {
      organizationId,
      sessionId,
      revision: plan.revision,
      generation: plan.rescan
        ? plan.revision
        : plan.control.redactionGeneration,
    };
    // The generation the delta is computed against: none for a rescan, which rewrites every row.
    const baseline = plan.rescan ? null : published;
    let records: TraceRawRecord[] = [];
    if (published.revision > 0n)
      await drainPages(
        (after) => repository.rawPage(published, { after, limit: 1000 }),
        (page) => records.push(...page.records),
      );
    let header =
      published.revision > 0n
        ? await repository.readSession(
            organizationId,
            sessionId,
            published.revision,
            published.generation,
          )
        : null;
    let context = normalizerContextSchema.parse(plan.control.normalizerContext);
    let lifecycle = false;
    // Every hit the accepts (by record) and this rescan (below) applied, attributed to
    // messages once the projection exists.
    const recorded: RecordedRedaction[] = [];
    for (const outbox of plan.outboxes.filter((row) => row.kind === "ingest")) {
      const payload = traceOutboxPayloadSchema.parse(outbox.payload);
      for (const hit of payload.redactions)
        recorded.push({
          ...hit,
          ingestBatchId: payload.envelope.batchId,
          redactedAt: outbox.createdAt,
        });
      const incoming = payload.records.map(sourceFromOutbox);
      const raw = incoming.map((record) => ({
        ...record,
        ingestBatchId: payload.envelope.batchId,
        recordType:
          typeof record.payload.type === "string"
            ? record.payload.type
            : "unknown",
      }));
      records.push(...raw);
      const scope: TraceScope = {
        organizationId,
        sessionId,
        revision: outbox.revision,
        generation: plan.control.redactionGeneration,
      };
      for (let offset = 0; offset < raw.length; offset += SINK_BATCH)
        if (
          !(await guarded(() =>
            repository.appendRaw(scope, raw.slice(offset, offset + SINK_BATCH)),
          ))
        )
          return null;
      header ??= initialHeader(
        plan.control,
        payload.envelope,
        outbox.createdAt,
      );
      header.last_activity_at = outbox.createdAt;
      if (payload.lifecycleApplied) {
        if (payload.envelope.behavior === "end") {
          header.status = "ENDED";
          header.ended_at = new Date(payload.envelope.sentAt);
          header.end_reason = payload.envelope.end?.reason ?? null;
          header.end_commit = payload.envelope.end?.head ?? null;
          header.observed_commits =
            payload.envelope.end?.observedCommits ?? null;
          header.observed_diff_stat =
            payload.envelope.end?.observedDiffStat ?? null;
          header.dirty_file_count =
            payload.envelope.end?.dirtyFileCount ?? null;
        } else {
          header.status = "ACTIVE";
          header.ended_at = null;
          header.end_reason = null;
        }
      }
      context = payload.normalizerContext;
      lifecycle ||= payload.envelope.start?.resume ?? false;
    }
    if (!header)
      throw new Error("A trace projection has no durable header source.");
    const rewritten =
      plan.rescan && plan.redactor
        ? await redactTraceSnapshot(
            plan.redactor,
            plan.control,
            header,
            records,
          )
        : null;
    if (
      rewritten &&
      snapshotUnchanged(records, header, plan.control, rewritten)
    )
      return "unchanged";
    if (rewritten) {
      records = rewritten.records;
      header = rewritten.header;
      context = rewritten.control.normalizerContext;
      for (let offset = 0; offset < records.length; offset += SINK_BATCH)
        if (
          !(await guarded(() =>
            repository.appendRaw(
              target,
              records.slice(offset, offset + SINK_BATCH),
            ),
          ))
        )
          return null;
      const lastReceipt = plan.receipts.at(-1);
      if (lastReceipt)
        rewritten.counts.set(lastReceipt.id, [
          ...(rewritten.counts.get(lastReceipt.id) ?? []),
          ...rewritten.metadataCounts,
        ]);
      const rescannedAt = new Date();
      for (const hit of rewritten.hits)
        recorded.push({ ...hit, redactedAt: rescannedAt });
      if (lastReceipt)
        for (const hit of rewritten.metadataCounts)
          recorded.push({
            recordId: null,
            ingestBatchId: lastReceipt.id,
            policyId: hit.policyId,
            count: hit.count,
            redactedAt: rescannedAt,
            // A rescan re-redacts metadata from its own text, so its hit keeps a real sample.
            preview: hit.sample?.preview ?? null,
            fingerprint: hit.sample?.fingerprint ?? null,
            length: hit.sample?.length ?? null,
          });
    }
    const projection = projectTrace(
      {
        id: sessionId,
        harness: header.harness,
        cwd: header.cwd,
        repoRoot: header.repo_root,
        normalizerContext: context,
        projectedContext: normalizerContextSchema.parse(
          rewritten?.control.projectedContext ?? plan.control.projectedContext,
        ),
      },
      records,
      plan.resumes,
      { lifecycle, rescan: plan.rescan !== null },
    );
    const messages: TraceMessageDelta[] = [];
    const files: TraceFileDelta[] = [];
    if (projection) {
      const oldMessages = await this.manifest(baseline, "messages");
      for (const message of projection.messages) {
        const hash = fingerprint(message);
        if (oldMessages.get(message.id) !== hash)
          messages.push({ id: message.id, message, fingerprint: hash });
        oldMessages.delete(message.id);
      }
      for (const id of oldMessages.keys())
        messages.push({ id, message: null, fingerprint: fingerprint(null) });
      const oldFiles = await this.manifest(baseline, "files");
      for (const file of projection.files) {
        const hash = fingerprint(file.ops);
        if (oldFiles.get(file.path) !== hash)
          files.push({ ...file, fingerprint: hash });
        oldFiles.delete(file.path);
      }
      for (const path of oldFiles.keys())
        files.push({ path, ops: null, fingerprint: fingerprint(null) });
      let toolCalls = 0;
      const tools = new Set<string>();
      let inputTokens = 0n;
      let outputTokens = 0n;
      for (const message of projection.messages) {
        if (message.kind === "TOOL_USE") toolCalls++;
        if (message.tool_name) tools.add(message.tool_name);
        inputTokens += message.input_tokens ?? 0n;
        outputTokens += message.output_tokens ?? 0n;
      }
      const delta = projection.delta;
      header = {
        ...header,
        ...(header.repo_name || !delta.repoUrl
          ? {}
          : snakeRepository(delta.repoUrl)),
        branch: delta.branch ?? header.branch,
        // The hook-reported start branch (already in the header) unioned with every branch
        // the transcript records, so a mid-session switch stays searchable. Distinct, first-seen.
        observed_branches: [
          ...new Set([
            ...header.observed_branches,
            ...(delta.branchesObserved ?? []),
          ]),
        ],
        harness_version: delta.harnessVersion ?? header.harness_version,
        entrypoint: delta.entrypoint ?? header.entrypoint,
        model: delta.model ?? null,
        models_used: delta.modelsUsed ?? [],
        started_at: delta.startedAt ?? header.started_at,
        title:
          delta.title === undefined
            ? null
            : Array.from(delta.title).slice(0, 120).join(""),
        first_prompt:
          delta.firstPrompt === undefined
            ? null
            : truncateUtf8(delta.firstPrompt, 4096),
        agent_type: delta.agentType ?? header.agent_type,
        start_commit: header.start_commit ?? delta.startCommit ?? null,
        message_count: projection.messages.length,
        tool_call_count: toolCalls,
        tools_used: [...tools].sort(),
        input_tokens: inputTokens,
        output_tokens: outputTokens,
      };
    }
    const snapshot = header;
    for (
      let offset = 0;
      offset < Math.max(1, messages.length, files.length);
      offset += SINK_BATCH
    )
      if (
        !(await guarded(() =>
          repository.writeProjection({
            ...target,
            session: snapshot,
            messages: messages.slice(offset, offset + SINK_BATCH),
            files: files.slice(offset, offset + SINK_BATCH),
          }),
        ))
      )
        return null;
    if (
      !(await guarded(() =>
        repository.appendReceipts(
          target,
          plan.receipts,
          plan.receipts.flatMap((receipt) => {
            const counts = new Map(
              receipt.redactions.map((hit) => [hit.policyId, hit.count]),
            );
            for (const hit of rewritten?.counts.get(receipt.id) ?? [])
              counts.set(
                hit.policyId,
                (counts.get(hit.policyId) ?? 0) + hit.count,
              );
            return [...counts].map(([policyId, count]) => ({
              receiptId: receipt.id,
              policyId,
              count,
            }));
          }),
        ),
      ))
    )
      return null;
    // Tool-policy detection (§9.7): evaluate the projection's tool calls against the
    // organization's rules and record the matches on publish, even while enforcement is off.
    const policyRow = await this.dependencies.prisma.toolPolicy.findUnique({
      where: { organizationId },
    });
    const toolPolicy = toolPolicySchema.parse({
      enabled: policyRow?.enabled ?? false,
      rules: policyRow?.rules ?? [],
    });
    return {
      target,
      snapshot,
      rewritten,
      projection,
      messages,
      files,
      hits: attributeRedactionHits(recorded, projection?.messages ?? []),
      violations: projection
        ? projectToolPolicyViolations(
            toolPolicy.rules,
            snapshot.harness,
            projection.messages,
          )
        : null,
      violationsEnforced: toolPolicy.enabled,
    };
  }
  /** Commit the built generation on the control row, if the lease still holds. */
  private async publish(plan: Plan, build: Build): Promise<void> {
    const { organizationId, sessionId } = plan;
    const {
      target,
      snapshot,
      rewritten,
      projection,
      messages,
      files,
      hits,
      violations,
      violationsEnforced,
    } = build;
    await this.dependencies.prisma.$transaction(async (tx) => {
      await lockSession(tx, organizationId, sessionId);
      const current = await tx.traceSessionControl.findUniqueOrThrow({
        where: { organizationId_id: { organizationId, id: sessionId } },
      });
      if (
        current.purgedAt ||
        current.projectionLease !== plan.lease ||
        current.publishedRevision !== plan.control.publishedRevision
      )
        return;
      if (plan.rescan) await this.reauthorizeRescan(tx, plan.rescan);
      if (rewritten && plan.redactor) {
        const text = await this.redactControlText(tx, current, plan.redactor);
        rewritten.control.normalizerContext = text.normalizerContext;
        rewritten.control.parentNativeRef = text.parentNativeRef;
      }
      if (rewritten)
        for (const [receiptId, counts] of rewritten.counts)
          await persistRedactionCounts(
            tx,
            organizationId,
            receiptId,
            sessionId,
            counts,
          );
      await persistRedactionHits(
        tx,
        organizationId,
        sessionId,
        plan.rescan?.runId ?? null,
        hits,
      );
      if (violations !== null)
        await persistToolPolicyViolations(
          tx,
          organizationId,
          sessionId,
          violationsEnforced,
          violations,
        );
      await tx.traceSessionControl.update({
        where: { organizationId_id: { organizationId, id: sessionId } },
        data: {
          ...(rewritten
            ? {
                harnessSessionId: rewritten.control.harnessSessionId,
                parentNativeRef: rewritten.control.parentNativeRef,
                normalizerContext: rewritten.control.normalizerContext,
                projectedContext: rewritten.control.projectedContext,
              }
            : {}),
          redactionGeneration: target.generation,
          publishedRevision: plan.revision,
          startedAt: snapshot.started_at,
          embeddingRevision: null,
          embeddingSourceRevision: null,
          projectionLease: null,
          projectionLeaseUntil: null,
          projectionState:
            current.acceptedRevision > plan.revision
              ? "queued"
              : projection?.ready
                ? "published"
                : "waiting_source",
          projectionError: projection?.ready
            ? null
            : "Waiting for the native transcript branch to arrive.",
          ...(projection?.ready
            ? { projectedContext: projection.context }
            : {}),
        },
      });
      await tx.embeddingState.updateMany({
        where: { organizationId, sessionId },
        data: { complete: false },
      });
      await this.dependencies.scheduleEmbeddings?.(tx, {
        organizationId,
        sessionId,
      });
      // Only the receipts this plan appended: an empty receipt accepted since the
      // reservation waits for the next publish rather than being marked without a row.
      await tx.traceReceipt.updateMany({
        where: {
          organizationId,
          sessionId,
          id: { in: plan.receipts.map((receipt) => receipt.id) },
          publishedAt: null,
        },
        data: { publishedAt: new Date() },
      });
      await tx.traceOutbox.deleteMany({
        where: { id: { in: plan.outboxes.map((row) => row.id) } },
      });
      if (plan.rescan)
        await completeRunSession(
          tx,
          organizationId,
          plan.rescan.runId,
          sessionId,
          [...(rewritten?.counts.values() ?? [])]
            .flat()
            .reduce((sum, hit) => sum + hit.count, 0),
        );
      await this.audit(tx, organizationId, {
        action: plan.rescan ? "redaction.rescan.session" : "trace.publish",
        resourceType: "session",
        resourceIds: [sessionId],
        detail: {
          revision: String(plan.revision),
          ...(plan.rescan ? { run_id: plan.rescan.runId } : {}),
          changed_messages: messages.length,
          changed_files: files.length,
          projection_ready: projection?.ready ?? false,
        },
      });
    });
  }
  /**
   * Re-redact the control row's native text with the rescan's engine. An upload can
   * advance the native context while a generation is built, so the latest accepted
   * context is redacted rather than replaced with an older snapshot; the installation's
   * observed fields are rewritten in place.
   */
  private async redactControlText(
    tx: Prisma.TransactionClient,
    current: TraceSessionControl,
    redactor: Redactor,
  ) {
    const { organizationId } = current;
    const normalizerContext = (
      await redactNormalizerContext(
        normalizerContextSchema.parse(current.normalizerContext),
        redactor,
      )
    ).value;
    const parentNativeRef =
      current.parentNativeRef === null
        ? null
        : (await canonicalIdentity(current.parentNativeRef, redactor)).value;
    const installation = await tx.installation.findUniqueOrThrow({
      where: {
        organizationId_id: { organizationId, id: current.installationId },
      },
    });
    await tx.installation.update({
      where: { organizationId_id: { organizationId, id: installation.id } },
      data: {
        hostname: (await redactor.text(installation.hostname)).value,
        osUser: (await redactor.text(installation.osUser)).value,
        platform: (await redactor.text(installation.platform)).value,
        arch: (await redactor.text(installation.arch)).value,
      },
    });
    return { normalizerContext, parentNativeRef };
  }
  /**
   * Checkpoint a rescan target whose re-redacted snapshot equals the published generation
   * (ADR 0066). The accepted revision is published with no sink write and no new
   * generation: readers select `revision <= published_revision` within the current
   * generation and no row exists at the new revision, so their row sets are identical
   * before and after and the publication fence is not needed. Embeddings computed from
   * this content stay current. Progress, the per-session audit and the authority recheck
   * are the same as for a rebuilt target.
   */
  private async publishUnchanged(plan: Plan): Promise<void> {
    const { organizationId, sessionId, rescan, redactor } = plan;
    if (!rescan || !redactor)
      throw new Error("Only a rescan can publish an unchanged snapshot.");
    await this.dependencies.prisma.$transaction(async (tx) => {
      if (!(await lockTraceSessionControl(tx, organizationId, sessionId)))
        return;
      const current = await tx.traceSessionControl.findUniqueOrThrow({
        where: { organizationId_id: { organizationId, id: sessionId } },
      });
      if (
        current.purgedAt ||
        current.projectionLease !== plan.lease ||
        current.publishedRevision !== plan.control.publishedRevision
      )
        return;
      await this.reauthorizeRescan(tx, rescan);
      const text = await this.redactControlText(tx, current, redactor);
      await tx.traceSessionControl.update({
        where: { organizationId_id: { organizationId, id: sessionId } },
        data: {
          normalizerContext: text.normalizerContext,
          parentNativeRef: text.parentNativeRef,
          publishedRevision: plan.revision,
          ...(current.embeddingSourceRevision === current.publishedRevision
            ? { embeddingSourceRevision: plan.revision }
            : {}),
          projectionLease: null,
          projectionLeaseUntil: null,
          // The projection did not change, so neither did its readiness; the claim set
          // the row to queued and it returns to published (a pi session still waiting
          // for a branch is relabelled by the upload that brings it).
          projectionState:
            current.acceptedRevision > plan.revision ? "queued" : "published",
        },
      });
      await tx.traceOutbox.deleteMany({
        where: { id: { in: plan.outboxes.map((row) => row.id) } },
      });
      await completeRunSession(tx, organizationId, rescan.runId, sessionId, 0);
      await this.audit(tx, organizationId, {
        action: "redaction.rescan.session",
        resourceType: "session",
        resourceIds: [sessionId],
        detail: {
          revision: String(plan.revision),
          run_id: rescan.runId,
          unchanged: true,
          changed_messages: 0,
          changed_files: 0,
        },
      });
    });
  }
  /**
   * Receipts accepted without a revision (empty syncs, §5.2) are appended at the current
   * published revision once nothing else is pending, so analytics see their lifecycle
   * decision without waiting for the next content publish. A pending revision carries
   * them instead; an unpublished session gets them with its first publish.
   */
  private async publishReceipts(
    organizationId: string,
    sessionId: string,
  ): Promise<void> {
    const { prisma, repository } = this.dependencies;
    await prisma.$transaction(
      async (tx) => {
        await lockSession(tx, organizationId, sessionId);
        const control = await tx.traceSessionControl.findUnique({
          where: { organizationId_id: { organizationId, id: sessionId } },
        });
        if (
          !control ||
          control.purgedAt ||
          control.publishedRevision === 0n ||
          control.acceptedRevision !== control.publishedRevision
        )
          return;
        const receipts = await tx.traceReceipt.findMany({
          where: { organizationId, sessionId, publishedAt: null },
          include: { redactions: true },
        });
        if (!receipts.length) return;
        await repository.appendReceipts(
          {
            organizationId,
            sessionId,
            revision: control.publishedRevision,
            generation: control.redactionGeneration,
          },
          receipts,
          receipts.flatMap((receipt) =>
            receipt.redactions.map((hit) => ({
              receiptId: receipt.id,
              policyId: hit.policyId,
              count: hit.count,
            })),
          ),
        );
        await tx.traceReceipt.updateMany({
          where: {
            organizationId,
            sessionId,
            id: { in: receipts.map((receipt) => receipt.id) },
            publishedAt: null,
          },
          data: { publishedAt: new Date() },
        });
        await this.audit(tx, organizationId, {
          action: "trace.publish",
          resourceType: "session",
          resourceIds: [sessionId],
          detail: {
            revision: String(control.publishedRevision),
            receipts: receipts.length,
            changed_messages: 0,
            changed_files: 0,
            projection_ready: control.projectionState === "published",
          },
        });
      },
      { timeout: 40_000, maxWait: 10_000 },
    );
  }
  /** Release the lease and mark the failure; the accepted upload stays queued for a retry. */
  private async fail(plan: Plan, error: unknown): Promise<never> {
    const { organizationId, sessionId } = plan;
    await this.dependencies.prisma.$transaction(async (tx) => {
      const changed = await tx.traceSessionControl.updateMany({
        where: { organizationId, id: sessionId, projectionLease: plan.lease },
        data: {
          projectionLease: null,
          projectionLeaseUntil: null,
          projectionState: "failed",
          projectionError:
            "Trace publication failed. The accepted upload is retained for retry.",
        },
      });
      if (changed.count)
        await this.audit(tx, organizationId, {
          action: "trace.publish",
          statusCode: 503,
          resourceType: "session",
          resourceIds: [sessionId],
          detail: { failed: true, retained: true },
        });
    });
    throw new Error("Trace publication failed; retry the durable outbox.", {
      cause: error,
    });
  }
  /**
   * Reclaim the rows a committed publish superseded: the previous header and the older
   * rows of each changed message or file (§5.2). Gated on the change size and revision;
   * `publish` returns without committing when its lease was lost, so the committed
   * revision is read back rather than assumed.
   */
  private async cleanupSuperseded(plan: Plan, build: Build): Promise<void> {
    const changed = build.messages.length + build.files.length;
    if (
      changed === 0 ||
      (plan.revision % SUPERSEDED_CLEANUP_EVERY_REVISIONS !== 0n &&
        changed <= SUPERSEDED_CLEANUP_ROWS)
    )
      return;
    const { organizationId, sessionId } = plan;
    const { prisma, repository } = this.dependencies;
    await prisma.$transaction(
      async (tx) => {
        await lockTraceSink(tx, organizationId, sessionId, "write");
        const locked = await tx.traceSessionControl.findUnique({
          where: { organizationId_id: { organizationId, id: sessionId } },
        });
        if (
          !locked ||
          locked.purgedAt ||
          locked.publishedRevision < plan.revision
        )
          return;
        await repository.deleteSupersededRevisions({
          organizationId,
          sessionId,
          revision: locked.publishedRevision,
          generation: locked.redactionGeneration,
        });
        await this.audit(tx, organizationId, {
          action: "trace.revision.cleanup",
          resourceType: "session",
          resourceIds: [sessionId],
          detail: {
            revision: String(locked.publishedRevision),
            changed_rows: changed,
          },
        });
      },
      { timeout: 40_000, maxWait: 10_000 },
    );
  }
  /** Drop superseded redaction generations; `pending` is the control row when the caller already read it. */
  private async cleanupGenerations(
    organizationId: string,
    sessionId: string,
    pending?: TraceSessionControl | null,
  ): Promise<void> {
    const { prisma, repository } = this.dependencies;
    const current =
      pending === undefined
        ? await prisma.traceSessionControl.findUnique({
            where: { organizationId_id: { organizationId, id: sessionId } },
          })
        : pending;
    if (
      !current ||
      current.purgedAt ||
      current.redactionCleanedGeneration >= current.redactionGeneration
    )
      return;
    await prisma.$transaction(
      async (tx) => {
        await lockTraceSink(tx, organizationId, sessionId, "write");
        const locked = await tx.traceSessionControl.findUniqueOrThrow({
          where: { organizationId_id: { organizationId, id: sessionId } },
        });
        if (
          locked.purgedAt ||
          locked.redactionCleanedGeneration >= locked.redactionGeneration
        )
          return;
        await repository.cleanupGenerations({
          organizationId,
          sessionId,
          revision: locked.publishedRevision,
          generation: locked.redactionGeneration,
        });
        await tx.traceSessionControl.update({
          where: { organizationId_id: { organizationId, id: sessionId } },
          data: { redactionCleanedGeneration: locked.redactionGeneration },
        });
        await this.audit(tx, organizationId, {
          action: "trace.redaction.cleanup",
          resourceType: "session",
          resourceIds: [sessionId],
          detail: { generation: String(locked.redactionGeneration) },
        });
      },
      { timeout: 40_000, maxWait: 10_000 },
    );
  }
  private async purge(
    organizationId: string,
    sessionId: string,
  ): Promise<void> {
    const { prisma, repository } = this.dependencies;
    await prisma.$transaction(
      async (tx) => {
        await lockTraceSink(tx, organizationId, sessionId, "write");
        const control = await tx.traceSessionControl.findUniqueOrThrow({
          where: { organizationId_id: { organizationId, id: sessionId } },
        });
        if (!control.purgedAt || control.purgeCompletedAt) return;
        const manifest = purgeOutputSchema.shape.manifest.parse(
          control.purgeManifest,
        );
        if (manifest.deleted.raw_records === null) {
          const counts = await repository.sessionCounts({
            organizationId,
            sessionId,
          });
          await tx.traceSessionControl.update({
            where: { organizationId_id: { organizationId, id: sessionId } },
            data: {
              purgeManifest: {
                ...manifest,
                deleted: { ...manifest.deleted, ...counts },
              },
            },
          });
        }
      },
      { timeout: 40_000, maxWait: 10_000 },
    );
    // The durable manifest commits before destructive sink work so a retry retains
    // the original logical counts even if some native deletes already completed.
    await prisma.$transaction(
      async (tx) => {
        await lockTraceSink(tx, organizationId, sessionId, "write");
        const control = await tx.traceSessionControl.findUniqueOrThrow({
          where: { organizationId_id: { organizationId, id: sessionId } },
        });
        if (!control.purgedAt || control.purgeCompletedAt) return;
        await repository.cleanupSession({ organizationId, sessionId });
        await tx.traceSessionControl.update({
          where: { organizationId_id: { organizationId, id: sessionId } },
          data: {
            purgeCompletedAt: new Date(),
            projectionLease: null,
            projectionLeaseUntil: null,
            projectionState: "published",
            projectionError: null,
          },
        });
        await tx.traceOutbox.deleteMany({
          where: { organizationId, sessionId, kind: "purge" },
        });
        await this.audit(tx, organizationId, {
          action: "session.purge.complete",
          resourceType: "session",
          resourceIds: [sessionId],
          detail: { deleted: control.purgeManifest },
        });
      },
      { timeout: 120_000, maxWait: 10_000 },
    );
  }
  /** Run one sink write under the session's shared sink lock while the lease still holds. */
  private async write(
    organizationId: string,
    sessionId: string,
    lease: string,
    operation: () => Promise<void>,
  ): Promise<boolean> {
    return this.dependencies.prisma.$transaction(
      async (tx) => {
        await lockTraceSink(tx, organizationId, sessionId, "read");
        const control = await tx.traceSessionControl.findUnique({
          where: { organizationId_id: { organizationId, id: sessionId } },
        });
        if (!control || control.purgedAt || control.projectionLease !== lease)
          return false;
        await operation();
        return true;
      },
      { timeout: 120_000, maxWait: 10_000 },
    );
  }
  /** Fingerprints of the rows published at `scope`; empty when there is no baseline. */
  private async manifest(scope: TraceScope | null, kind: "messages" | "files") {
    const values = new Map<string, string>();
    if (!scope || scope.revision === 0n) return values;
    await drainPages(
      (after) =>
        this.dependencies.repository.projectionManifest(scope, kind, {
          after,
          limit: 1000,
        }),
      (page) => {
        for (const item of page.items) values.set(item.id, item.fingerprint);
      },
    );
    return values;
  }
}
function snakeRepository(url: string) {
  const repository = repositoryIdentity(url);
  return { repo_url: repository.repoUrl, repo_name: repository.repoName };
}
function initialHeader(
  control: TraceSessionControl,
  envelope: IngestEnvelope,
  receivedAt: Date,
): TraceSession {
  const git = envelope.context.git;
  return {
    organization_id: control.organizationId,
    session_id: control.id,
    harness: control.harness,
    harness_session_id: control.harnessSessionId,
    harness_version: null,
    entrypoint: null,
    user_id: control.userId,
    ingest_api_key_id: control.ingestApiKeyId,
    installation_id: control.installationId,
    cwd: envelope.context.cwd,
    repo_root: git?.root ?? null,
    // A session started at the repository root is "." so readers can tell a known
    // root directory from an unknown one (every harness canary starts at the root).
    cwd_relative: git
      ? posix.relative(git.root, envelope.context.cwd) || "."
      : null,
    repo_url: git?.remoteUrl ?? null,
    repo_name: git?.remoteUrl ?? null,
    branch: git?.branch ?? null,
    observed_branches: git?.branch ? [git.branch] : [],
    start_commit: git?.head ?? null,
    end_commit: null,
    observed_commits: null,
    observed_diff_stat: null,
    dirty_file_count: null,
    model: null,
    models_used: [],
    started_at: receivedAt,
    ended_at: null,
    last_activity_at: receivedAt,
    status: "ACTIVE",
    end_reason: null,
    title: null,
    first_prompt: null,
    parent_session_id: control.parentSessionId,
    parent_relation: control.parentRelation,
    parent_native_ref: control.parentNativeRef,
    agent_type: envelope.context.parentHint?.agentType ?? null,
    message_count: 0,
    tool_call_count: 0,
    input_tokens: 0n,
    output_tokens: 0n,
    tools_used: [],
  };
}
