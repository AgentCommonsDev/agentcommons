import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { TraceFixtures } from "../../../packages/traces/test/fixtures.js";
import type { startTraceDatabase } from "../../../packages/traces/test/support.js";
import { requireCaller, type ServiceContext } from "../src/services/context.js";

/** The fixture week: September 2026, day 7 (a Monday) at the given UTC hour and minute. */
export const metricsAt = (day: number, hour = 0, minute = 0) =>
  new Date(Date.UTC(2026, 8, day, hour, minute));
/** The seven-day window every metrics fixture falls into. */
export const metricsFilters = {
  date_from: metricsAt(7).toISOString(),
  date_to: metricsAt(14).toISOString(),
};

interface MetricsSessionOptions {
  repo?: string;
  start?: Date;
  end?: Date;
  visibility?: "PUBLIC" | "PRIVATE";
  /** Tools rollout state of the session's installation. */
  enabled?: boolean;
  installationId?: string;
  hostname?: string;
  /** Extra `sessions` columns, already in their ClickHouse names. */
  fields?: Record<string, unknown>;
}
export interface MetricsReceiptOptions {
  behavior: string;
  sentAt: Date;
  sourcePos: number;
  id?: string;
  receivedAt?: Date;
  /** Whether the receipt changed lifecycle; the analytics views read it for starts and ends. */
  lifecycleApplied?: boolean;
  /** Also persist the control-side receipt row the way ingest does. */
  control?: boolean;
}

/**
 * Ended sessions, ingest receipts and vectors written straight to ClickHouse for the
 * metrics views, owned by a real organization's caller.
 */
export class MetricsFixtures {
  constructor(
    readonly db: Awaited<ReturnType<typeof startTraceDatabase>>,
    readonly fixtures: TraceFixtures,
  ) {}
  async session(context: ServiceContext, options: MetricsSessionOptions = {}) {
    const caller = requireCaller(context);
    const startedAt = options.start ?? metricsAt(7, 9);
    const endedAt = options.end ?? metricsAt(7, 10);
    const repoName = options.repo ?? "github.com/test/metrics";
    const { id, installationId } = await this.fixtures.sessionFor(context, {
      ...(options.installationId
        ? { installationId: options.installationId }
        : {}),
      hostname: options.hostname ?? "metrics fixture",
      toolsEnabled: options.enabled ?? true,
      visibility: options.visibility ?? "PUBLIC",
      fields: {
        harness: "CLAUDE_CODE",
        harness_session_id: randomUUID(),
        cwd: "/fixture",
        repo_name: repoName,
        started_at: startedAt,
        ended_at: endedAt,
        last_activity_at: endedAt,
        status: "ENDED",
        ...options.fields,
      },
    });
    await this.db.prisma.traceSessionControl.update({
      where: {
        organizationId_id: { organizationId: caller.organizationId, id },
      },
      data: { startedAt, lastActivityAt: endedAt, endedAt, status: "ENDED" },
    });
    return {
      id,
      organizationId: caller.organizationId,
      userId: caller.userId,
      ingestApiKeyId: z.string().parse(caller.apiKeyId),
      installationId,
      repoName,
      startedAt,
      endedAt,
    };
  }
  async receipt(
    row: Awaited<ReturnType<MetricsFixtures["session"]>>,
    options: MetricsReceiptOptions,
  ) {
    const id = options.id ?? randomUUID();
    const receivedAt = options.receivedAt ?? options.sentAt;
    const lifecycleApplied =
      options.lifecycleApplied ?? options.behavior !== "sync";
    const startResume = options.behavior === "start" && options.sourcePos > 0;
    await this.fixtures.insert("ingest_receipts", row.id, {
      receipt_id: id,
      installation_id: row.installationId,
      api_key_id: row.ingestApiKeyId,
      user_id: row.userId,
      source_pos: BigInt(options.sourcePos),
      sent_at: options.sentAt,
      received_at: receivedAt,
      behavior: options.behavior,
      start_resume: startResume,
      native_event: options.behavior,
      lifecycle_applied: lifecycleApplied,
    });
    if (options.control) {
      const control = await this.db.prisma.traceSessionControl.findFirstOrThrow(
        { where: { id: row.id } },
      );
      await this.db.prisma.traceReceipt.create({
        data: {
          organizationId: row.organizationId,
          id,
          sessionId: row.id,
          apiKeyId: row.ingestApiKeyId,
          userId: row.userId,
          installationId: row.installationId,
          cursor: randomUUID(),
          acceptedCount: 0,
          sourcePos: BigInt(options.sourcePos),
          sentAt: options.sentAt,
          behavior: options.behavior,
          startResume,
          nativeEvent: options.behavior,
          lifecycleApplied,
          receivedAt,
          recordCount: 0,
          duplicateCount: 0,
          byteCount: 0n,
          redactionCount: 0,
          durationMs: 0,
          revision: control.publishedRevision,
          publishedAt: receivedAt,
        },
      });
    }
    return { id };
  }
  /** Active windows the reuse metrics derive from a session's receipts. */
  async windows(context: ServiceContext, id: string) {
    return this.db.traceReaders.read(requireCaller(context), async (client) =>
      z
        .array(
          z.object({
            active_from: z.coerce.date(),
            active_to: z.coerce.date(),
          }),
        )
        .parse(
          (
            await client.query(
              "SELECT active_from,active_to FROM api_ro.metrics_active_windows WHERE session_id={id:UUID}",
              { id },
            )
          ).rows,
        ),
    );
  }
  /** A published summary vector for the session, at its current revision. */
  async vectorFixture(row: { id: string }, vector: string) {
    await this.fixtures.insert("session_embeddings", row.id, {
      model: "text-embedding-3-small",
      token_count: 1,
      updated_at: new Date(),
      embedding: z.array(z.number()).parse(JSON.parse(vector)),
    });
    const control = await this.db.prisma.traceSessionControl.findFirstOrThrow({
      where: { id: row.id },
    });
    await this.db.prisma.traceSessionControl.update({
      where: {
        organizationId_id: {
          organizationId: control.organizationId,
          id: row.id,
        },
      },
      data: {
        embeddingRevision: control.publishedRevision,
        embeddingSourceRevision: control.publishedRevision,
      },
    });
  }
}
