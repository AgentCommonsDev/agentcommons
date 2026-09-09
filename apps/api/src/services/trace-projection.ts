import {
  redactTraceSnapshot,
  traceRescanPayloadSchema,
} from "./trace-rescan.js";
import { createPolicyCache } from "./policy-cache.js";
import { reauthorizeJob } from "../auth/jobs.js";
import { requirePermission, ServiceError } from "./context.js";
import { persistRedactionCounts } from "./policies.js";
import { wireValue } from "./read-budget.js";
import { createHash } from "node:crypto";
import { posix } from "node:path";
import { v7 as uuidv7 } from "uuid";
import {
  lockTracePublication,
  lockTraceSink,
  type PrismaClient,
  type Prisma,
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
  type IngestEnvelope,
} from "@agentcommons/core";
import type {
  TraceRepository,
  TraceSession,
  TraceMessageDelta,
  TraceFileDelta,
  TraceScope,
  TraceRawRecord,
} from "@agentcommons/traces";
import type { AuditService } from "./audit.js";
import { operatorContext } from "../auth/bootstrap.js";
import { sourceFromOutbox, traceOutboxPayloadSchema } from "./trace-outbox.js";

const fingerprint = (value: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(wireValue(value)))
    .digest("hex");
export class TraceProjectionService {
  constructor(
    private readonly dependencies: {
      prisma: PrismaClient;
      audit: AuditService;
      repository: TraceRepository;
      allowedEmailDomains?: readonly string[];
      saas?: boolean;
      scheduleEmbeddings?: (
        tx: Prisma.TransactionClient,
        data: { organizationId: string; sessionId: string },
      ) => Promise<void>;
    },
  ) {}
  async process(organizationId: string, sessionId: string): Promise<void> {
    const { prisma, repository, audit } = this.dependencies;
    const purged = await prisma.traceSessionControl.findUnique({
      where: { organizationId_id: { organizationId, id: sessionId } },
      select: { purgedAt: true, purgeCompletedAt: true },
    });
    if (purged?.purgedAt) {
      if (!purged.purgeCompletedAt) {
        try {
          await this.purge(organizationId, sessionId);
        } catch (error) {
          await prisma.$transaction(async (tx) => {
            await tx.traceSessionControl.update({
              where: { organizationId_id: { organizationId, id: sessionId } },
              data: {
                projectionState: "failed",
                projectionError:
                  "Physical cleanup failed. The purge remains active and cleanup will retry.",
              },
            });
            await audit.write(
              operatorContext(),
              {
                action: "session.purge.complete",
                statusCode: 503,
                resourceType: "session",
                resourceIds: [sessionId],
                actor: {
                  organizationId,
                  userId: null,
                  apiKeyId: null,
                  authMethod: "worker",
                },
                detail: { failed: true, retained: true },
              },
              tx,
            );
          });
          throw new Error("Physical trace cleanup must retry.", {
            cause: error,
          });
        }
      }
      return;
    }
    await this.cleanupGenerations(organizationId, sessionId);
    const plan = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM organization WHERE id=${organizationId} FOR NO KEY UPDATE`;
      await lockTracePublication(tx, organizationId, "write");
      await tx.$queryRaw`SELECT id FROM trace_session_control WHERE organization_id=${organizationId} AND id=${sessionId}::uuid FOR UPDATE`;
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
      const rescan =
        outboxes[0]?.kind === "rescan"
          ? traceRescanPayloadSchema.parse(outboxes[0].payload)
          : null;
      if (rescan) {
        if (rescan.organizationId !== organizationId)
          throw new Error("Rescan scope mismatch.");
        try {
          const context = await reauthorizeJob(
            tx,
            {
              ...operatorContext(),
              caller: rescan.caller,
              requestId: rescan.requestId,
            },
            this.dependencies.allowedEmailDomains,
            this.dependencies.saas,
          );
          requirePermission(context, "admin");
        } catch (error) {
          if (!(error instanceof ServiceError) || error.statusCode !== 403)
            throw error;
          const cancelled = outboxes[0];
          if (!cancelled) throw new Error("Rescan boundary is missing.");
          await tx.traceOutbox.delete({ where: { id: cancelled.id } });
          await tx.traceSessionControl.update({
            where: { organizationId_id: { organizationId, id: sessionId } },
            data: {
              publishedRevision: cancelled.revision,
              projectionState:
                control.acceptedRevision > cancelled.revision
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
          await audit.write(
            operatorContext(),
            {
              action: "redaction.rescan.cancelled",
              statusCode: 403,
              resourceType: "session",
              resourceIds: [sessionId],
              actor: {
                organizationId,
                userId: null,
                apiKeyId: null,
                authMethod: "worker",
              },
              detail: { run_id: rescan.runId },
            },
            tx,
          );
          return null;
        }
      }
      const redactor = rescan
        ? await createPolicyCache(tx).get(organizationId)
        : null;
      const last = outboxes.at(-1);
      if (!last) return null;
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
      await audit.write(
        operatorContext(),
        {
          action: "trace.reserve",
          resourceType: "session",
          resourceIds: [sessionId],
          actor: {
            organizationId,
            userId: null,
            apiKeyId: null,
            authMethod: "worker",
          },
          detail: {
            revision: String(last.revision),
            outbox_batches: outboxes.length,
          },
        },
        tx,
      );
      const receipts = await tx.traceReceipt.findMany({
        where: {
          organizationId,
          sessionId,
          revision: {
            ...(rescan ? {} : { gt: control.publishedRevision }),
            lte: last.revision,
          },
        },
        include: { redactions: true },
      });
      return {
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
    if (!plan) return;
    try {
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
      let records: TraceRawRecord[] = [];
      let after: string | null = null;
      if (published.revision > 0n)
        do {
          const page = await repository.rawPage(published, {
            after,
            limit: 1000,
          });
          records.push(...page.records);
          after = page.after;
        } while (after);
      let header =
        published.revision > 0n
          ? await repository.readSession(
              organizationId,
              sessionId,
              published.revision,
              published.generation,
            )
          : null;
      let context = normalizerContextSchema.parse(
        plan.control.normalizerContext,
      );
      let lifecycle = false;
      for (const outbox of plan.outboxes.filter(
        (row) => row.kind === "ingest",
      )) {
        const payload = traceOutboxPayloadSchema.parse(outbox.payload);
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
        for (let offset = 0; offset < raw.length; offset += 500)
          if (
            !(await this.write(
              {
                organizationId,
                sessionId,
                revision: outbox.revision,
                generation: plan.control.redactionGeneration,
              },
              plan.lease,
              () =>
                repository.appendRaw(
                  {
                    organizationId,
                    sessionId,
                    revision: outbox.revision,
                    generation: plan.control.redactionGeneration,
                  },
                  raw.slice(offset, offset + 500),
                ),
            ))
          )
            return;
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
      if (rewritten) {
        records = rewritten.records;
        header = rewritten.header;
        context = rewritten.control.normalizerContext;
        for (let offset = 0; offset < records.length; offset += 500)
          if (
            !(await this.write(target, plan.lease, () =>
              repository.appendRaw(target, records.slice(offset, offset + 500)),
            ))
          )
            return;
        const lastReceipt = plan.receipts.at(-1);
        if (lastReceipt)
          rewritten.counts.set(lastReceipt.id, [
            ...(rewritten.counts.get(lastReceipt.id) ?? []),
            ...rewritten.metadataCounts,
          ]);
      }
      const projection = projectTrace(
        {
          id: sessionId,
          harness: header.harness,
          cwd: header.cwd,
          repoRoot: header.repo_root,
          normalizerContext: context,
          projectedContext: normalizerContextSchema.parse(
            rewritten?.control.projectedContext ??
              plan.control.projectedContext,
          ),
        },
        records,
        plan.resumes,
        { lifecycle, rescan: plan.rescan !== null },
      );
      const messages: TraceMessageDelta[] = [];
      const files: TraceFileDelta[] = [];
      if (projection) {
        const oldMessages = await this.manifest(
          plan.rescan ? { ...target, revision: 0n } : published,
          "messages",
        );
        for (const message of projection.messages) {
          const hash = fingerprint(message);
          if (oldMessages.get(message.id) !== hash)
            messages.push({ id: message.id, message, fingerprint: hash });
          oldMessages.delete(message.id);
        }
        for (const id of oldMessages.keys())
          messages.push({ id, message: null, fingerprint: fingerprint(null) });
        const oldFiles = await this.manifest(
          plan.rescan ? { ...target, revision: 0n } : published,
          "files",
        );
        for (const file of projection.files) {
          const hash = fingerprint(file.ops);
          if (oldFiles.get(file.path) !== hash)
            files.push({ ...file, fingerprint: hash });
          oldFiles.delete(file.path);
        }
        for (const path of oldFiles.keys())
          files.push({ path, ops: null, fingerprint: fingerprint(null) });
        const delta = projection.delta;
        header = {
          ...header,
          ...(header.repo_name || !delta.repoUrl
            ? {}
            : snakeRepository(delta.repoUrl)),
          branch: delta.branch ?? header.branch,
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
          tool_call_count: projection.messages.filter(
            (message) => message.kind === "TOOL_USE",
          ).length,
          tools_used: [
            ...new Set(
              projection.messages.flatMap((message) =>
                message.tool_name ? [message.tool_name] : [],
              ),
            ),
          ].sort(),
          input_tokens: projection.messages.reduce(
            (sum, message) => sum + (message.input_tokens ?? 0n),
            0n,
          ),
          output_tokens: projection.messages.reduce(
            (sum, message) => sum + (message.output_tokens ?? 0n),
            0n,
          ),
        };
      }
      const snapshot = header;
      for (
        let offset = 0;
        offset < Math.max(1, messages.length, files.length);
        offset += 500
      )
        if (
          !(await this.write(target, plan.lease, () =>
            repository.writeProjection({
              ...target,
              session: snapshot,
              messages: messages.slice(offset, offset + 500),
              files: files.slice(offset, offset + 500),
            }),
          ))
        )
          return;
      if (
        !(await this.write(target, plan.lease, () =>
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
        return;
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM organization WHERE id=${organizationId} FOR NO KEY UPDATE`;
        await lockTracePublication(tx, organizationId, "write");
        await tx.$queryRaw`SELECT id FROM trace_session_control WHERE organization_id=${organizationId} AND id=${sessionId}::uuid FOR UPDATE`;
        const current = await tx.traceSessionControl.findUniqueOrThrow({
          where: { organizationId_id: { organizationId, id: sessionId } },
        });
        if (
          current.purgedAt ||
          current.projectionLease !== plan.lease ||
          current.publishedRevision !== plan.control.publishedRevision
        )
          return;
        if (plan.rescan) {
          const context = await reauthorizeJob(
            tx,
            {
              ...operatorContext(),
              caller: plan.rescan.caller,
              requestId: plan.rescan.requestId,
            },
            this.dependencies.allowedEmailDomains,
            this.dependencies.saas,
          );
          requirePermission(context, "admin");
        }
        if (rewritten && plan.redactor) {
          // An upload can advance its native context while this generation is built.
          // Redact the latest accepted context without replacing it with an older snapshot.
          rewritten.control.normalizerContext = (
            await redactNormalizerContext(
              normalizerContextSchema.parse(current.normalizerContext),
              plan.redactor,
            )
          ).value;
          rewritten.control.parentNativeRef =
            current.parentNativeRef === null
              ? null
              : (
                  await canonicalIdentity(
                    current.parentNativeRef,
                    plan.redactor,
                  )
                ).value;
          const installation = await tx.installation.findUniqueOrThrow({
            where: {
              organizationId_id: { organizationId, id: current.installationId },
            },
          });
          await tx.installation.update({
            where: {
              organizationId_id: { organizationId, id: installation.id },
            },
            data: {
              hostname: (await plan.redactor.text(installation.hostname)).value,
              osUser: (await plan.redactor.text(installation.osUser)).value,
              platform: (await plan.redactor.text(installation.platform)).value,
              arch: (await plan.redactor.text(installation.arch)).value,
            },
          });
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
        await tx.traceReceipt.updateMany({
          where: {
            organizationId,
            sessionId,
            revision: { lte: plan.revision },
            publishedAt: null,
          },
          data: { publishedAt: new Date() },
        });
        await tx.traceOutbox.deleteMany({
          where: { id: { in: plan.outboxes.map((row) => row.id) } },
        });
        if (plan.rescan) {
          const count = [...(rewritten?.counts.values() ?? [])]
            .flat()
            .reduce((sum, hit) => sum + hit.count, 0);
          await tx.redactionRunSession.update({
            where: {
              organizationId_runId_sessionId: {
                organizationId,
                runId: plan.rescan.runId,
                sessionId,
              },
            },
            data: { processedAt: new Date() },
          });
          const run = await tx.redactionRun.update({
            where: {
              organizationId_id: { organizationId, id: plan.rescan.runId },
            },
            data: {
              processedSessions: { increment: 1 },
              redactionCount: { increment: count },
              error: null,
            },
          });
          await tx.redactionRun.update({
            where: { organizationId_id: { organizationId, id: run.id } },
            data: {
              state:
                run.processedSessions === run.totalSessions
                  ? "completed"
                  : "running",
            },
          });
        }
        await audit.write(
          operatorContext(),
          {
            action: plan.rescan ? "redaction.rescan.session" : "trace.publish",
            resourceType: "session",
            resourceIds: [sessionId],
            actor: {
              organizationId,
              userId: null,
              apiKeyId: null,
              authMethod: "worker",
            },
            detail: {
              revision: String(plan.revision),
              ...(plan.rescan ? { run_id: plan.rescan.runId } : {}),
              changed_messages: messages.length,
              changed_files: files.length,
              projection_ready: projection?.ready ?? false,
            },
          },
          tx,
        );
      });
      await this.cleanupGenerations(organizationId, sessionId);
    } catch (error) {
      await prisma.$transaction(async (tx) => {
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
          await audit.write(
            operatorContext(),
            {
              action: "trace.publish",
              statusCode: 503,
              resourceType: "session",
              resourceIds: [sessionId],
              actor: {
                organizationId,
                userId: null,
                apiKeyId: null,
                authMethod: "worker",
              },
              detail: { failed: true, retained: true },
            },
            tx,
          );
      });
      throw new Error("Trace publication failed; retry the durable outbox.", {
        cause: error,
      });
    }
  }
  private async cleanupGenerations(
    organizationId: string,
    sessionId: string,
  ): Promise<void> {
    const { prisma, repository, audit } = this.dependencies;
    const pending = await prisma.traceSessionControl.findUnique({
      where: { organizationId_id: { organizationId, id: sessionId } },
    });
    if (
      !pending ||
      pending.purgedAt ||
      pending.redactionCleanedGeneration >= pending.redactionGeneration
    )
      return;
    await prisma.$transaction(
      async (tx) => {
        await lockTraceSink(tx, organizationId, sessionId, "write");
        const current = await tx.traceSessionControl.findUniqueOrThrow({
          where: { organizationId_id: { organizationId, id: sessionId } },
        });
        if (
          current.purgedAt ||
          current.redactionCleanedGeneration >= current.redactionGeneration
        )
          return;
        await repository.cleanupGenerations({
          organizationId,
          sessionId,
          revision: current.publishedRevision,
          generation: current.redactionGeneration,
        });
        await tx.traceSessionControl.update({
          where: { organizationId_id: { organizationId, id: sessionId } },
          data: { redactionCleanedGeneration: current.redactionGeneration },
        });
        await audit.write(
          operatorContext(),
          {
            action: "trace.redaction.cleanup",
            resourceType: "session",
            resourceIds: [sessionId],
            actor: {
              organizationId,
              userId: null,
              apiKeyId: null,
              authMethod: "worker",
            },
            detail: { generation: String(current.redactionGeneration) },
          },
          tx,
        );
      },
      { timeout: 40_000, maxWait: 10_000 },
    );
  }
  private async purge(
    organizationId: string,
    sessionId: string,
  ): Promise<void> {
    const { prisma, repository, audit } = this.dependencies;
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
        await audit.write(
          operatorContext(),
          {
            action: "session.purge.complete",
            resourceType: "session",
            resourceIds: [sessionId],
            actor: {
              organizationId,
              userId: null,
              apiKeyId: null,
              authMethod: "worker",
            },
            detail: { deleted: control.purgeManifest },
          },
          tx,
        );
      },
      { timeout: 120_000, maxWait: 10_000 },
    );
  }
  private async write(
    scope: TraceScope,
    lease: string,
    operation: () => Promise<void>,
  ): Promise<boolean> {
    return this.dependencies.prisma.$transaction(
      async (tx) => {
        await lockTraceSink(tx, scope.organizationId, scope.sessionId, "read");
        const control = await tx.traceSessionControl.findUnique({
          where: {
            organizationId_id: {
              organizationId: scope.organizationId,
              id: scope.sessionId,
            },
          },
        });
        if (!control || control.purgedAt || control.projectionLease !== lease)
          return false;
        await operation();
        return true;
      },
      { timeout: 120_000, maxWait: 10_000 },
    );
  }
  private async manifest(scope: TraceScope, kind: "messages" | "files") {
    const values = new Map<string, string>();
    if (scope.revision === 0n) return values;
    let after: string | null = null;
    do {
      const page = await this.dependencies.repository.projectionManifest(
        scope,
        kind,
        { after, limit: 1000 },
      );
      for (const item of page.items) values.set(item.id, item.fingerprint);
      after = page.after;
    } while (after);
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
