import type { Prisma } from "@agentcommons/db";
import { z } from "zod";
import {
  harnessSchema,
  jsonValueSchema,
  type ProjectedMessage,
  type SourceRecord,
} from "@agentcommons/core";
import { EMBEDDING_DIMENSIONS } from "./schema.js";

/** Where a body of trace rows belongs: organization, session, source revision and redaction generation. */
export const traceScopeSchema = z.object({
  organizationId: z.string().min(1),
  sessionId: z.uuid(),
  /** Positive PostgreSQL source revision (or independent vector epoch), without JS precision loss. */
  revision: z.bigint().nonnegative(),
  /** Current redaction generation; older generations are never reader-visible. */
  generation: z.bigint().nonnegative(),
});
export type TraceScope = z.infer<typeof traceScopeSchema>;
export interface TraceRawRecord extends SourceRecord {
  ingestBatchId: string;
  recordType: string;
}
/** The projected session header as services read and write it (decoded, not wire text). */
export const traceSessionSchema = z.object({
  session_id: z.uuid(),
  organization_id: z.string().min(1),
  harness: harnessSchema,
  harness_session_id: z.string(),
  harness_version: z.string().nullable(),
  entrypoint: z.string().nullable(),
  user_id: z.string(),
  ingest_api_key_id: z.string(),
  installation_id: z.uuid(),
  cwd: z.string(),
  repo_root: z.string().nullable(),
  cwd_relative: z.string().nullable(),
  repo_url: z.string().nullable(),
  repo_name: z.string().nullable(),
  branch: z.string().nullable(),
  start_commit: z.string().nullable(),
  end_commit: z.string().nullable(),
  observed_commits: jsonValueSchema,
  observed_diff_stat: jsonValueSchema,
  dirty_file_count: z.number().int().nullable(),
  model: z.string().nullable(),
  models_used: z.array(z.string()),
  started_at: z.date(),
  ended_at: z.date().nullable(),
  last_activity_at: z.date(),
  status: z.enum(["ACTIVE", "ENDED", "INACTIVE"]),
  end_reason: z.string().nullable(),
  title: z.string().nullable(),
  first_prompt: z.string().nullable(),
  parent_session_id: z.uuid().nullable(),
  parent_relation: z.enum(["SUBAGENT", "FORK", "SPAWNED"]).nullable(),
  parent_native_ref: z.string().nullable(),
  agent_type: z.string().nullable(),
  message_count: z.number().int().nonnegative(),
  tool_call_count: z.number().int().nonnegative(),
  input_tokens: z.bigint(),
  output_tokens: z.bigint(),
  tools_used: z.array(z.string()),
});
export type TraceSession = z.infer<typeof traceSessionSchema>;
export interface TraceMessageDelta {
  id: string;
  /** null is a tombstone; filtering occurs after latest-version selection. */
  message: ProjectedMessage | null;
  fingerprint: string;
}
export interface TraceFileDelta {
  path: string;
  ops: string[] | null;
  fingerprint: string;
}
export interface TraceProjectionWrite extends TraceScope {
  session: TraceSession;
  messages: readonly TraceMessageDelta[];
  files: readonly TraceFileDelta[];
}
export interface TraceManifestEntry {
  id: string;
  fingerprint: string;
}
export interface TraceRawPage {
  records: TraceRawRecord[];
  after: string | null;
}
export interface TraceParameters {
  [name: string]:
    string | number | boolean | bigint | null | readonly unknown[];
}
export interface TraceQueryResult<Row> {
  rows: Row[];
  /** Lossless cell order for arbitrary SQL, including duplicate column names. */
  data: unknown[][];
  fields: { name: string; type: string }[];
}
export interface TraceQueryClient {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    parameters?: TraceParameters,
  ): Promise<TraceQueryResult<Row>>;
}
/** Same control transaction that holds the publication fence; never acquire a nested pool connection. */
export interface TraceReadClient extends TraceQueryClient {
  control: Prisma.TransactionClient;
}

export const traceEmbeddingVectorSchema = z
  .array(z.number())
  .length(EMBEDDING_DIMENSIONS);
export const traceEmbeddingChunkSchema = z.object({
  id: z.uuid(),
  messageId: z.uuid(),
  ordinal: z.number().int().nonnegative(),
  content: z.string(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  tokenCount: z.number().int().nonnegative(),
  model: z.string().min(1),
  embedding: traceEmbeddingVectorSchema,
});
export type TraceEmbeddingChunk = z.infer<typeof traceEmbeddingChunkSchema>;
export const traceEmbeddingWriteSchema = z.object({
  chunks: z.array(traceEmbeddingChunkSchema).readonly(),
  session: z
    .object({
      model: z.string().min(1),
      tokenCount: z.number().int().nonnegative(),
      embedding: traceEmbeddingVectorSchema,
    })
    .nullable(),
  updatedAt: z.date(),
});
export type TraceEmbeddingWrite = z.infer<typeof traceEmbeddingWriteSchema>;
/** One control-plane audit event as the trace corpus stores it for the audit analytics views. */
export const traceAuditSchema = z.object({
  id: z.uuid(),
  organization_id: z.string().min(1),
  ts: z.date(),
  user_id: z.string().nullable(),
  user_email: z.string().nullable(),
  api_key_id: z.string().nullable(),
  installation_id: z.uuid().nullable(),
  auth_method: z.string(),
  transport: z.string(),
  action: z.string(),
  resource_ids: z.array(z.string()),
  status_code: z.number().int(),
  duration_ms: z.number().int().nonnegative(),
  detail: jsonValueSchema,
});
export type TraceAudit = z.infer<typeof traceAuditSchema>;
/** One `session_reads` row: an audit read credited to the session active on its installation. */
export const traceSessionReadSchema = z.object({
  organization_id: z.string().min(1),
  session_id: z.uuid(),
  audit_id: z.uuid(),
  read_at: z.date(),
  action: z.string().min(1),
  target_session_id: z.uuid(),
  reader_user_id: z.string().nullable(),
  reader_email: z.string().nullable(),
  reader_harness: z.string().min(1),
});
export type TraceSessionRead = z.infer<typeof traceSessionReadSchema>;
