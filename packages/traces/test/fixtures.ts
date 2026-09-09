import { randomUUID } from "node:crypto";
import {
  createTraceClient,
  traceTables,
  type TraceScope,
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
  /**
   * One physical row at an explicit revision and generation, with empty defaults for
   * unnamed columns. Control is not consulted or advanced: the caller decides publication.
   */
  async insertRaw(
    table: TraceTable,
    scope: TraceScope,
    fields: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const row = {
      ...emptyTraceRow(table),
      deleted: 0,
      fingerprint: "a".repeat(64),
      ...fields,
      organization_id: scope.organizationId,
      session_id: scope.sessionId,
      generation: scope.generation,
      revision: scope.revision,
    };
    await this.client.insert({
      table,
      values: [validateTraceRow(table, row)],
      format: "JSONEachRow",
    });
    return row;
  }
  /** Publish one row as the next revision of an existing control row. */
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
    const row = await this.insertRaw(
      table,
      {
        organizationId: control.organizationId,
        sessionId,
        revision,
        generation: control.redactionGeneration,
      },
      fields,
    );
    this.rows.set(
      `${table}:${sessionId}:${JSON.stringify(row[traceTables[table].identity])}`,
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
    parentToolUseId?: string;
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
        parentToolUseId: options.parentToolUseId ?? null,
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
  /**
   * A session owned by the caller's organization, user and key; its installation row is
   * created when missing so read tests need no seeded installation of their own.
   */
  async sessionFor(
    context: {
      caller: {
        organizationId: string;
        userId: string;
        apiKeyId: string | null;
      } | null;
    },
    options: Omit<
      Parameters<TraceFixtures["session"]>[0],
      "organizationId" | "userId" | "keyId" | "installationId"
    > & {
      installationId?: string;
      hostname?: string;
      toolsEnabled?: boolean;
    } = {},
  ) {
    const caller = context.caller;
    if (!caller?.apiKeyId)
      throw new Error("Expected a key-authenticated caller for the session.");
    const {
      installationId = randomUUID(),
      hostname = "fixture",
      toolsEnabled = true,
      ...session
    } = options;
    await this.db.prisma.installation.upsert({
      where: {
        organizationId_id: {
          organizationId: caller.organizationId,
          id: installationId,
        },
      },
      create: {
        organizationId: caller.organizationId,
        id: installationId,
        hostname,
        osUser: "fixture",
        platform: "linux",
        arch: "x64",
        toolsEnabled,
      },
      update: {},
    });
    const id = await this.session({
      ...session,
      organizationId: caller.organizationId,
      userId: caller.userId,
      keyId: caller.apiKeyId,
      installationId,
    });
    return { id, installationId };
  }
  close() {
    return this.client.close();
  }
}
