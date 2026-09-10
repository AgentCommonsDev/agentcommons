import type { TraceReceipt } from "@agentcommons/db";
import { createHash } from "node:crypto";
import { type ClickHouseClient } from "@clickhouse/client";
import { z } from "zod";
import {
  jsonObjectSchema,
  redactionContextSchema,
  jsonValueSchema,
  messageRoleSchema,
  messageKindSchema,
  type ProjectedMessage,
} from "@agentcommons/core";
import {
  createTraceClient,
  queryTrace,
  sqlIdentifier,
  sqlString,
} from "./client.js";
import type { ClickHouseConfig } from "./config.js";
import {
  EMBEDDING_DIMENSIONS,
  TRACE_PAGE_BYTES,
  traceTables,
  rawColumns,
  messageColumns,
  type TraceTable,
} from "./schema.js";
import { emptyTraceRow, traceWire, validateTraceRow } from "./rows.js";
import { SESSION_READS_TABLE } from "./reads.js";
import {
  traceAuditSchema,
  traceSessionReadSchema,
  type TraceSessionRead,
  traceEmbeddingChunkSchema,
  traceEmbeddingVectorSchema,
  traceEmbeddingWriteSchema,
  traceScopeSchema,
  traceSessionSchema,
  type TraceAudit,
  type TraceScope,
  type TraceRawRecord,
  type TraceRawPage,
  type TraceProjectionWrite,
  type TraceSession,
  type TraceManifestEntry,
  type TraceEmbeddingChunk,
  type TraceEmbeddingWrite,
  type TraceParameters,
} from "./types.js";

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");
/** Digest of a trace value in its wire form; publishers compare it against stored manifests. */
export const fingerprint = (value: unknown): string =>
  sha256(JSON.stringify(traceWire(value)));
const pageInput = z.object({
  after: z.string().nullable(),
  limit: z.number().int().min(1).max(1000),
});
const backfillName = z.string().regex(/^[a-z][a-z0-9_]*$/);
const jsonText = z
  .string()
  .transform((value) => jsonValueSchema.parse(JSON.parse(value)));
const rawReadSchema = z.object({
  raw_record_id: z.uuid(),
  pos: z.coerce.bigint(),
  key: z.string().nullable(),
  source_version: z.number().int(),
  payload: z
    .string()
    .transform((value) => jsonObjectSchema.parse(JSON.parse(value))),
  redaction_context: z
    .string()
    .transform((value) => redactionContextSchema.parse(JSON.parse(value))),
  received_at: z.coerce.date(),
  ingest_batch_id: z.uuid(),
  record_type: z.string(),
});
/** A stored header row as ClickHouse returns it, decoded into the session shape. */
const sessionRowSchema = traceSessionSchema.extend({
  observed_commits: jsonText,
  observed_diff_stat: jsonText,
  started_at: z.coerce.date(),
  ended_at: z.coerce.date().nullable(),
  last_activity_at: z.coerce.date(),
  input_tokens: z.coerce.bigint(),
  output_tokens: z.coerce.bigint(),
});
const chunk = traceEmbeddingChunkSchema.shape;
/** A stored chunk row, decoded into the chunk shape. */
const chunkRowSchema = z
  .object({
    chunk_id: chunk.id,
    message_id: chunk.messageId,
    ordinal: chunk.ordinal,
    content: chunk.content,
    content_hash: chunk.contentHash,
    token_count: chunk.tokenCount,
    model: chunk.model,
    embedding: chunk.embedding,
  })
  .transform((row): TraceEmbeddingChunk => ({
    id: row.chunk_id,
    messageId: row.message_id,
    ordinal: row.ordinal,
    content: row.content,
    contentHash: row.content_hash,
    tokenCount: row.token_count,
    model: row.model,
    embedding: row.embedding,
  }));
/** Tables whose surviving row counts a purge manifest reports. */
const sessionCountTables = [
  "raw_records",
  "messages",
  "session_files",
  "message_chunks",
  "session_embeddings",
] as const satisfies readonly TraceTable[];
export type TraceSessionCounts = Record<
  (typeof sessionCountTables)[number],
  number
>;
export class TraceRepository {
  private readonly client: ClickHouseClient;
  constructor(private readonly config: ClickHouseConfig) {
    this.client = createTraceClient({
      url: config.url,
      database: config.database,
      username: config.username,
      password: config.password,
      request_timeout: 30000,
      max_open_connections: 4,
      compression: { request: true },
      clickhouse_settings: {
        date_time_input_format: "best_effort",
        date_time_output_format: "iso",
        output_format_json_quote_64bit_integers: 1,
      },
    });
  }
  private latest(
    table: TraceTable,
    scope: TraceScope,
  ): {
    sql: string;
    parameters: {
      organization: string;
      session: string;
      revision: string;
      generation: string;
    };
  } {
    traceScopeSchema.parse(scope);
    const { columns: definition, identity } = traceTables[table];
    const columns = Object.keys(definition);
    return {
      sql: `SELECT ${columns.map((column, index) => `tupleElement(row,${String(index + 1)}) AS ${sqlIdentifier(column)}`).join(",")},tupleElement(row,${String(columns.length + 1)}) AS fingerprint FROM (SELECT argMax(tuple(${columns.map(sqlIdentifier).join(",")},fingerprint,deleted),revision) AS row FROM ${sqlIdentifier(this.config.database)}.${sqlIdentifier(table)} FINAL WHERE organization_id={organization:String} AND session_id={session:UUID} AND generation={generation:Int64} AND revision<={revision:Int64} GROUP BY ${sqlIdentifier(identity)}) WHERE tupleElement(row,${String(columns.length + 2)})=0`,
      parameters: {
        organization: scope.organizationId,
        session: scope.sessionId,
        revision: scope.revision.toString(),
        generation: scope.generation.toString(),
      },
    };
  }
  private async insert(
    table: TraceTable,
    rows: Record<string, unknown>[],
  ): Promise<void> {
    let values: Record<string, unknown>[] = [];
    let bytes = 0;
    const flush = async () => {
      if (values.length)
        await this.client.insert({
          table: `${this.config.database}.${table}`,
          values,
          format: "JSONEachRow",
        });
      values = [];
      bytes = 0;
    };
    for (const row of rows) {
      const value = validateTraceRow(table, row);
      const size = Buffer.byteLength(JSON.stringify(value));
      if (
        values.length &&
        (values.length >= 500 || bytes + size > TRACE_PAGE_BYTES)
      )
        await flush();
      values.push(value);
      bytes += size;
    }
    await flush();
  }
  async appendRaw(
    scope: TraceScope,
    records: readonly TraceRawRecord[],
  ): Promise<void> {
    traceScopeSchema.parse(scope);
    await this.insert(
      "raw_records",
      records.map((record) => {
        const row = {
          raw_record_id: record.id,
          organization_id: scope.organizationId,
          session_id: scope.sessionId,
          ingest_batch_id: record.ingestBatchId,
          pos: record.pos,
          source_version: record.sourceVersion,
          key: record.key,
          record_type: record.recordType,
          payload: JSON.stringify(record.payload),
          redaction_context: JSON.stringify(record.redactionContext),
          received_at: record.receivedAt,
        };
        return {
          ...row,
          revision: scope.revision,
          generation: scope.generation,
          deleted: 0,
          fingerprint: fingerprint(row),
        };
      }),
    );
  }
  async writeProjection(input: TraceProjectionWrite): Promise<void> {
    traceScopeSchema.parse(input);
    if (
      input.session.organization_id !== input.organizationId ||
      input.session.session_id !== input.sessionId
    )
      throw new Error("Projection session scope mismatch.");
    const scope = {
      organization_id: input.organizationId,
      session_id: input.sessionId,
      revision: input.revision,
      generation: input.generation,
    };
    const session = {
      ...input.session,
      observed_commits: JSON.stringify(input.session.observed_commits),
      observed_diff_stat: JSON.stringify(input.session.observed_diff_stat),
    };
    // Readers see the revision only once control publishes it, so the three tables
    // need no write order between them.
    await Promise.all([
      this.insert("sessions", [
        {
          ...session,
          ...scope,
          deleted: 0,
          fingerprint: fingerprint(session),
        },
      ]),
      this.insert(
        "messages",
        input.messages.map((delta) => {
          const source = delta.message;
          if (source && source.id !== delta.id)
            throw new Error("Projection message identity mismatch.");
          const row = source
            ? {
                ...Object.fromEntries(
                  Object.entries(source).filter(([name]) => name !== "id"),
                ),
                message_id: source.id,
                tool_input: JSON.stringify(source.tool_input),
              }
            : { ...emptyTraceRow("messages"), message_id: delta.id };
          return {
            ...row,
            ...scope,
            deleted: source ? 0 : 1,
            fingerprint: delta.fingerprint,
          };
        }),
      ),
      this.insert(
        "session_files",
        input.files.map((file) => ({
          ...scope,
          file_id: sha256(file.path),
          path: file.path,
          ops: file.ops ?? [],
          deleted: file.ops ? 0 : 1,
          fingerprint: file.fingerprint,
        })),
      ),
    ]);
  }
  async readSession(
    organizationId: string,
    sessionId: string,
    revision: bigint,
    generation: bigint,
  ): Promise<TraceSession | null> {
    const source = this.latest("sessions", {
      organizationId,
      sessionId,
      revision,
      generation,
    });
    const result = await queryTrace(this.client, source.sql, source.parameters);
    const row = result.rows[0];
    return row ? sessionRowSchema.parse(row) : null;
  }
  async rawPage(
    scope: TraceScope,
    input: { after: string | null; limit: number },
  ): Promise<TraceRawPage> {
    const page = pageInput.parse(input);
    if (page.after) z.uuid().parse(page.after);
    const source = this.latest("raw_records", scope);
    const rows = await queryTrace(
      this.client,
      `WITH candidates AS (SELECT * FROM (${source.sql}) WHERE ({after:Nullable(UUID)} IS NULL OR raw_record_id>{after:Nullable(UUID)}) ORDER BY raw_record_id LIMIT {limit:UInt32}), bounded AS (SELECT *,sum(length(payload)+length(redaction_context)) OVER(ORDER BY raw_record_id) AS bytes,row_number() OVER(ORDER BY raw_record_id) ordinal FROM candidates) SELECT ${Object.keys(rawColumns).map(sqlIdentifier).join(",")} FROM bounded WHERE bytes<=${String(TRACE_PAGE_BYTES)} OR ordinal=1 ORDER BY raw_record_id`,
      { ...source.parameters, after: page.after, limit: page.limit },
    );
    const records = rows.rows.map((row) => {
      const value = rawReadSchema.parse(row);
      return {
        id: value.raw_record_id,
        pos: value.pos,
        key: value.key,
        sourceVersion: value.source_version,
        payload: value.payload,
        redactionContext: value.redaction_context,
        receivedAt: value.received_at,
        ingestBatchId: value.ingest_batch_id,
        recordType: value.record_type,
      };
    });
    return { records, after: records.at(-1)?.id ?? null };
  }
  async messagesPage(
    scope: TraceScope,
    input: { after: string | null; limit: number },
  ): Promise<{ items: ProjectedMessage[]; after: string | null }> {
    const page = pageInput.parse(input);
    if (page.after) z.uuid().parse(page.after);
    const source = this.latest("messages", scope);
    const columns = Object.keys(messageColumns).map(sqlIdentifier).join(",");
    const result = await queryTrace(
      this.client,
      `WITH candidates AS (SELECT * FROM (${source.sql}) WHERE ({after:Nullable(UUID)} IS NULL OR message_id>{after:Nullable(UUID)}) ORDER BY message_id LIMIT {limit:UInt32}), bounded AS (SELECT *,sum(byteSize(tuple(${columns}))) OVER(ORDER BY message_id) AS bytes,row_number() OVER(ORDER BY message_id) AS ordinal FROM candidates) SELECT ${columns} FROM bounded WHERE bytes<=${String(TRACE_PAGE_BYTES)} OR ordinal=1 ORDER BY message_id`,
      { ...source.parameters, after: page.after, limit: page.limit },
    );
    const shape = z.object({
      message_id: z.uuid(),
      raw_record_id: z.uuid().nullable(),
      ingest_batch_id: z.uuid().nullable(),
      block_index: z.number().int().nonnegative(),
      seq: z.number().int().nonnegative(),
      role: messageRoleSchema,
      kind: messageKindSchema,
      content: z.string(),
      tool_name: z.string().nullable(),
      tool_use_id: z.string().nullable(),
      tool_input: jsonText,
      model: z.string().nullable(),
      timestamp: z.coerce.date().nullable(),
      received_at: z.coerce.date(),
      input_tokens: z.coerce.bigint().nullable(),
      output_tokens: z.coerce.bigint().nullable(),
      agent_id: z.string().nullable(),
      native_id: z.string().nullable(),
      parent_native_id: z.string().nullable(),
      searchable: z.boolean(),
      search_text: z.string(),
    });
    const items = result.rows.map((row) => {
      const { message_id, ...message } = shape.parse(row);
      return { id: message_id, ...message };
    });
    return { items, after: items.at(-1)?.id ?? null };
  }
  async projectionManifest(
    scope: TraceScope,
    kind: "messages" | "files",
    input: { after: string | null; limit: number },
  ): Promise<{ items: TraceManifestEntry[]; after: string | null }> {
    const page = pageInput.parse(input);
    const table = kind === "messages" ? "messages" : "session_files";
    const { identity, identityType } = traceTables[table];
    const id = sqlIdentifier(identity);
    // The cursor carries the identity column's own type: a UUID sorts differently from its
    // text form, and a text-compared cursor over UUID order skips most of a large session.
    const after = `{after:Nullable(${identityType})}`;
    const source = this.latest(table, scope);
    const rows = await queryTrace(
      this.client,
      `SELECT toString(${id}) AS cursor,${kind === "files" ? "path" : id} AS id,fingerprint FROM (${source.sql}) WHERE (${after} IS NULL OR ${id}>${after}) ORDER BY ${id} LIMIT {limit:UInt32}`,
      { ...source.parameters, after: page.after, limit: page.limit },
    );
    const values = rows.rows.map((row) =>
      z
        .object({ cursor: z.string(), id: z.string(), fingerprint: z.string() })
        .parse(row),
    );
    return {
      items: values.map(({ id, fingerprint }) => ({ id, fingerprint })),
      after: values.at(-1)?.cursor ?? null,
    };
  }
  async appendReceipts(
    scope: TraceScope,
    receipts: readonly TraceReceipt[],
    redactions: readonly {
      receiptId: string;
      policyId: string;
      count: number;
      deleted?: boolean;
    }[] = [],
  ): Promise<void> {
    traceScopeSchema.parse(scope);
    await this.insert(
      "ingest_receipts",
      receipts.map((receipt) => {
        if (
          receipt.organizationId !== scope.organizationId ||
          receipt.sessionId !== scope.sessionId
        )
          throw new Error("Receipt scope mismatch.");
        const row = {
          organization_id: scope.organizationId,
          session_id: scope.sessionId,
          receipt_id: receipt.id,
          installation_id: receipt.installationId,
          api_key_id: receipt.apiKeyId,
          user_id: receipt.userId,
          source_pos: receipt.sourcePos,
          sent_at: receipt.sentAt,
          received_at: receipt.receivedAt,
          behavior: receipt.behavior,
          native_event: receipt.nativeEvent,
          start_resume: receipt.startResume,
          lifecycle_applied: receipt.lifecycleApplied,
          accepted_count: receipt.acceptedCount,
          duplicate_count: receipt.duplicateCount,
          record_count: receipt.recordCount,
          byte_count: receipt.byteCount,
          redaction_count: receipt.redactionCount,
          duration_ms: receipt.durationMs,
        };
        return {
          ...row,
          revision: scope.revision,
          generation: scope.generation,
          deleted: 0,
          fingerprint: fingerprint(row),
        };
      }),
    );
    await this.insert(
      "receipt_redactions",
      redactions.map((value) => {
        const row = {
          organization_id: scope.organizationId,
          session_id: scope.sessionId,
          redaction_id: sha256(value.receiptId + "\0" + value.policyId),
          receipt_id: value.receiptId,
          policy_id: value.policyId,
          count: value.count,
        };
        return {
          ...row,
          revision: scope.revision,
          generation: scope.generation,
          deleted: value.deleted ? 1 : 0,
          fingerprint: sha256(JSON.stringify(row)),
        };
      }),
    );
  }
  async embeddingsPage(
    scope: TraceScope,
    input: { after: string | null; limit: number },
  ): Promise<{ items: TraceEmbeddingChunk[]; after: string | null }> {
    const page = pageInput.parse(input);
    if (page.after) z.uuid().parse(page.after);
    const source = this.latest("message_chunks", scope);
    const result = await queryTrace(
      this.client,
      `SELECT chunk_id,message_id,ordinal,content,content_hash,token_count,model,embedding FROM (${source.sql}) WHERE ({after:Nullable(UUID)} IS NULL OR chunk_id>{after:Nullable(UUID)}) ORDER BY chunk_id LIMIT {limit:UInt32}`,
      { ...source.parameters, after: page.after, limit: page.limit },
    );
    const items = result.rows.map((row) => chunkRowSchema.parse(row));
    return { items, after: items.at(-1)?.id ?? null };
  }
  async readSessionEmbedding(scope: TraceScope): Promise<{
    model: string;
    tokenCount: number;
    embedding: number[];
    updatedAt: Date;
  } | null> {
    traceScopeSchema.parse(scope);
    const rows = await queryTrace(
      this.client,
      `SELECT model,token_count,embedding,updated_at FROM ${sqlIdentifier(this.config.database)}.session_embeddings FINAL WHERE organization_id={organization:String} AND session_id={session:UUID} AND generation={generation:Int64} AND revision={revision:Int64} AND deleted=0`,
      {
        organization: scope.organizationId,
        session: scope.sessionId,
        generation: scope.generation.toString(),
        revision: scope.revision.toString(),
      },
    );
    if (!rows.rows.length) return null;
    const value = z
      .object({
        model: z.string(),
        token_count: z.number().int().nonnegative(),
        embedding: traceEmbeddingVectorSchema,
        updated_at: z.coerce.date(),
      })
      .parse(rows.rows[0]);
    return {
      model: value.model,
      tokenCount: value.token_count,
      embedding: value.embedding,
      updatedAt: value.updated_at,
    };
  }
  async writeEmbeddings(
    scope: TraceScope,
    input: TraceEmbeddingWrite,
  ): Promise<void> {
    traceScopeSchema.parse(scope);
    const value = traceEmbeddingWriteSchema.parse(input);
    const ids = new Set(value.chunks.map((item) => item.id));
    if (ids.size !== value.chunks.length)
      throw new Error("Duplicate embedding chunk identity.");
    if (
      value.chunks.some(
        (item) => value.session !== null && item.model !== value.session.model,
      )
    )
      throw new Error("Embedding models must agree within one publication.");
    const common = {
      organization_id: scope.organizationId,
      session_id: scope.sessionId,
      revision: scope.revision,
      generation: scope.generation,
    };
    const source = this.latest("message_chunks", scope);
    const previous = await queryTrace(
      this.client,
      `SELECT chunk_id FROM (${source.sql})`,
      source.parameters,
    );
    const tombstones = previous.rows
      .map((row) => z.uuid().parse(row.chunk_id))
      .filter((id) => !ids.has(id))
      .map((id) => ({
        ...emptyTraceRow("message_chunks"),
        ...common,
        chunk_id: id,
        embedding: Array<number>(EMBEDDING_DIMENSIONS).fill(0),
        deleted: 1,
        fingerprint: sha256("deleted:" + id),
      }));
    await this.insert("message_chunks", [
      ...value.chunks.map((item) => {
        const row = {
          ...common,
          chunk_id: item.id,
          message_id: item.messageId,
          ordinal: item.ordinal,
          content: item.content,
          content_hash: item.contentHash,
          token_count: item.tokenCount,
          model: item.model,
          embedding: item.embedding,
        };
        return {
          ...row,
          deleted: 0,
          fingerprint: fingerprint(row),
        };
      }),
      ...tombstones,
    ]);
    if (value.session === null) return;
    const session = {
      ...common,
      model: value.session.model,
      token_count: value.session.tokenCount,
      embedding: value.session.embedding,
      updated_at: value.updatedAt,
    };
    await this.insert("session_embeddings", [
      {
        ...session,
        deleted: 0,
        fingerprint: fingerprint(session),
      },
    ]);
  }
  async appendAudit(rows: readonly TraceAudit[]): Promise<void> {
    const values = rows.map((row) => {
      const { id, ...value } = traceAuditSchema.parse(row);
      return {
        ...(traceWire(value) as Record<string, unknown>),
        audit_id: id,
        detail: JSON.stringify(value.detail),
      };
    });
    if (values.length)
      await this.client.insert({
        table: `${this.config.database}.audit_events`,
        values,
        format: "JSONEachRow",
      });
  }
  /** Reads the audit projection credited to active sessions; the key dedupes a retried flush. */
  async appendSessionReads(rows: readonly TraceSessionRead[]): Promise<void> {
    const values = rows.map(
      (row) =>
        traceWire(traceSessionReadSchema.parse(row)) as Record<string, unknown>,
    );
    if (values.length)
      await this.client.insert({
        table: `${this.config.database}.${SESSION_READS_TABLE}`,
        values,
        format: "JSONEachRow",
      });
  }
  /** Whether the named one-time derivation has run to completion on this corpus. */
  async backfillCompleted(name: string): Promise<boolean> {
    const result = await queryTrace(
      this.client,
      `SELECT count() AS count FROM ${sqlIdentifier(this.config.database)}.backfills FINAL WHERE name={name:String}`,
      { name: backfillName.parse(name) },
    );
    return z.coerce.number().int().parse(result.rows[0]?.count) > 0;
  }
  async completeBackfill(name: string): Promise<void> {
    await this.client.insert({
      table: `${this.config.database}.backfills`,
      values: [
        {
          name: backfillName.parse(name),
          completed_at: new Date().toISOString(),
        },
      ],
      format: "JSONEachRow",
    });
  }
  async sessionCounts(scope: {
    organizationId: string;
    sessionId: string;
  }): Promise<TraceSessionCounts> {
    z.object({ organizationId: z.string().min(1), sessionId: z.uuid() }).parse(
      scope,
    );
    const result = await queryTrace(
      this.client,
      sessionCountTables
        .map(
          (table) =>
            `SELECT ${sqlString(table)} AS table_name,uniqExact(${sqlIdentifier(traceTables[table].identity)}) AS count FROM ${sqlIdentifier(this.config.database)}.${sqlIdentifier(table)} WHERE organization_id={organization:String} AND session_id={session:UUID}`,
        )
        .join(" UNION ALL "),
      { organization: scope.organizationId, session: scope.sessionId },
    );
    const counts = new Map(
      z
        .array(
          z.object({
            table_name: z.enum(sessionCountTables),
            count: z.coerce.number().int().nonnegative(),
          }),
        )
        .parse(result.rows)
        .map((row) => [row.table_name, row.count]),
    );
    const count = z.number();
    return {
      raw_records: count.parse(counts.get("raw_records")),
      messages: count.parse(counts.get("messages")),
      session_files: count.parse(counts.get("session_files")),
      message_chunks: count.parse(counts.get("message_chunks")),
      session_embeddings: count.parse(counts.get("session_embeddings")),
    };
  }
  /** One synchronous `ALTER TABLE … DELETE` per table over the session's rows that also satisfy `where`. */
  private async deleteRows(
    tables: ReadonlyArray<readonly [string, { readonly identity: string }]>,
    where: (table: string, identity: string) => string,
    parameters: TraceParameters,
  ): Promise<void> {
    const signal = AbortSignal.timeout(30000);
    for (const [table, { identity }] of tables)
      await this.client.command({
        query: `ALTER TABLE ${sqlIdentifier(this.config.database)}.${sqlIdentifier(table)} DELETE WHERE organization_id={organization:String} AND session_id={session:UUID}${where(table, identity)}`,
        query_params: parameters,
        clickhouse_settings: { mutations_sync: "2" },
        abort_signal: signal,
      });
  }
  private async cleanup(
    scope: { organizationId: string; sessionId: string },
    generation?: bigint,
  ): Promise<void> {
    z.object({ organizationId: z.string().min(1), sessionId: z.uuid() }).parse(
      scope,
    );
    if (generation !== undefined) z.bigint().nonnegative().parse(generation);
    await this.deleteRows(
      Object.entries(traceTables),
      () =>
        generation === undefined ? "" : " AND generation<{generation:Int64}",
      {
        organization: scope.organizationId,
        session: scope.sessionId,
        ...(generation === undefined
          ? {}
          : { generation: generation.toString() }),
      },
    );
  }
  /**
   * Reclaims rows the published revision has superseded: within `scope.generation`, every
   * row of an identity older than that identity's newest row at or below `scope.revision`.
   * Rows above the published revision, other generations (`cleanupGenerations`) and the
   * vector tables, whose revision is the separately fenced vector epoch, stay untouched, so
   * the latest rows readers resolve are identical before and after.
   */
  async deleteSupersededRevisions(scope: TraceScope): Promise<void> {
    traceScopeSchema.parse(scope);
    const published =
      "WHERE organization_id={organization:String} AND session_id={session:UUID} AND generation={generation:Int64} AND revision<={revision:Int64}";
    await this.deleteRows(
      Object.entries(traceTables).filter(([, table]) => !table.vector),
      (table, identity) => {
        const id = sqlIdentifier(identity);
        const from = `FROM ${sqlIdentifier(this.config.database)}.${sqlIdentifier(table)} ${published}`;
        return ` AND generation={generation:Int64} AND revision<{revision:Int64} AND (${id},revision) IN (SELECT ${id},revision ${from} AND (${id},revision) NOT IN (SELECT ${id},max(revision) ${from} GROUP BY ${id}))`;
      },
      {
        organization: scope.organizationId,
        session: scope.sessionId,
        generation: scope.generation.toString(),
        revision: scope.revision.toString(),
      },
    );
  }
  async cleanupSession(scope: {
    organizationId: string;
    sessionId: string;
  }): Promise<void> {
    await this.cleanup(scope);
  }
  async cleanupGenerations(scope: TraceScope): Promise<void> {
    traceScopeSchema.parse(scope);
    await this.cleanup(scope, scope.generation);
  }
  async ready(): Promise<boolean> {
    try {
      return (await this.client.ping()).success;
    } catch {
      return false;
    }
  }
  async close(): Promise<void> {
    await this.client.close();
  }
}
