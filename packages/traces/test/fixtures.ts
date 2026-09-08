import { randomUUID } from "node:crypto";
import {
  createTraceClient,
  traceTables,
  type TraceTable,
} from "../src/index.js";
import { emptyTraceRow, validateTraceRow } from "../src/rows.js";
import type { startTraceDatabase } from "./support.js";

/** Native storage fixtures for read contracts. Ingest contracts use the real outbox/worker. */
export class TraceFixtures {
  readonly client;
  private readonly revisions = new Map<string, bigint>();
  private readonly rows = new Map<string, Record<string, unknown>>();
  constructor(readonly db: Awaited<ReturnType<typeof startTraceDatabase>>) {
    this.client = createTraceClient(db.traceConfig);
  }
  async insert(
    table: TraceTable,
    sessionId: string,
    fields: Record<string, unknown>,
  ) {
    const control = await this.db.prisma.traceSessionControl.findFirstOrThrow({
      where: { id: sessionId },
    });
    const previous = this.revisions.get(sessionId) ?? 0n;
    const revision =
      (previous > control.publishedRevision
        ? previous
        : control.publishedRevision) + 1n;
    this.revisions.set(sessionId, revision);
    const row = {
      ...emptyTraceRow(table),
      deleted: 0,
      fingerprint: "a".repeat(64),
      ...fields,
      organization_id: control.organizationId,
      session_id: sessionId,
      generation: control.redactionGeneration,
      revision,
    };
    await this.client.insert({
      table,
      values: [validateTraceRow(table, row)],
      format: "JSONEachRow",
    });
    this.rows.set(
      `${table}:${sessionId}:${JSON.stringify(traceTables[table].keys.filter((key) => !["organization_id", "session_id", "generation", "revision"].includes(key)).map((key) => row[key as keyof typeof row]))}`,
      row,
    );
    await this.db.prisma.traceSessionControl.update({
      where: {
        organizationId_id: {
          organizationId: control.organizationId,
          id: sessionId,
        },
      },
      data: { acceptedRevision: revision, publishedRevision: revision },
    });
  }
  async update(
    table: TraceTable,
    sessionId: string,
    fields: Record<string, unknown>,
    predicate: (row: Record<string, unknown>) => boolean = () => true,
  ) {
    for (const [key, row] of [...this.rows])
      if (key.startsWith(`${table}:${sessionId}:`) && predicate(row)) {
        const value = Object.fromEntries(
          Object.entries(row).filter(([key]) => key !== "revision"),
        );
        await this.insert(table, sessionId, { ...value, ...fields });
      }
  }
  async session(options: {
    id?: string;
    organizationId: string;
    userId: string;
    keyId: string;
    installationId: string;
    parent?: string;
    visibility?: "PUBLIC" | "PRIVATE";
    fields?: Record<string, unknown>;
  }) {
    const id = options.id ?? randomUUID();
    const now = new Date("2026-08-01T00:00:00Z");
    await this.db.prisma.traceSessionControl.create({
      data: {
        id,
        organizationId: options.organizationId,
        harness: "CODEX",
        nativeIdentity: id,
        harnessSessionId: id,
        userId: options.userId,
        ingestApiKeyId: options.keyId,
        installationId: options.installationId,
        startedAt: now,
        lastActivityAt: now,
        parentSessionId: options.parent ?? null,
        parentRelation: options.parent ? "SUBAGENT" : null,
        visibility: options.visibility ?? "PUBLIC",
        projectionState: "published",
      },
    });
    await this.insert("sessions", id, {
      harness: "CODEX",
      harness_session_id: id,
      user_id: options.userId,
      ingest_api_key_id: options.keyId,
      installation_id: options.installationId,
      cwd: "/repo",
      started_at: now,
      last_activity_at: now,
      status: "ACTIVE",
      observed_commits: "null",
      observed_diff_stat: "null",
      ...options.fields,
    });
    return id;
  }
  close() {
    return this.client.close();
  }
}
