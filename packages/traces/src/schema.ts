/** Canonical ClickHouse storage columns. JSON values use canonical UTF-8 JSON text. */
export const sessionColumns = {
  session_id: "UUID",
  organization_id: "String",
  harness: "LowCardinality(String)",
  harness_session_id: "String",
  harness_version: "Nullable(String)",
  entrypoint: "Nullable(String)",
  user_id: "String",
  ingest_api_key_id: "String",
  installation_id: "UUID",
  cwd: "String",
  repo_root: "Nullable(String)",
  cwd_relative: "Nullable(String)",
  repo_url: "Nullable(String)",
  repo_name: "Nullable(String)",
  branch: "Nullable(String)",
  start_commit: "Nullable(String)",
  end_commit: "Nullable(String)",
  observed_commits: "String",
  observed_diff_stat: "String",
  dirty_file_count: "Nullable(Int32)",
  model: "Nullable(String)",
  models_used: "Array(String)",
  started_at: "DateTime64(6, 'UTC')",
  ended_at: "Nullable(DateTime64(6, 'UTC'))",
  last_activity_at: "DateTime64(6, 'UTC')",
  status: "LowCardinality(String)",
  end_reason: "Nullable(String)",
  title: "Nullable(String)",
  first_prompt: "Nullable(String)",
  parent_session_id: "Nullable(UUID)",
  parent_relation: "Nullable(String)",
  parent_native_ref: "Nullable(String)",
  agent_type: "Nullable(String)",
  message_count: "UInt32",
  tool_call_count: "UInt32",
  input_tokens: "Int64",
  output_tokens: "Int64",
  tools_used: "Array(String)",
} as const;
export const messageColumns = {
  message_id: "UUID",
  organization_id: "String",
  session_id: "UUID",
  raw_record_id: "Nullable(UUID)",
  ingest_batch_id: "Nullable(UUID)",
  seq: "UInt32",
  block_index: "UInt32",
  role: "LowCardinality(String)",
  kind: "LowCardinality(String)",
  content: "String",
  tool_name: "Nullable(String)",
  tool_use_id: "Nullable(String)",
  tool_input: "String",
  model: "Nullable(String)",
  timestamp: "Nullable(DateTime64(6, 'UTC'))",
  received_at: "DateTime64(6, 'UTC')",
  input_tokens: "Nullable(Int64)",
  output_tokens: "Nullable(Int64)",
  agent_id: "Nullable(String)",
  native_id: "Nullable(String)",
  parent_native_id: "Nullable(String)",
  searchable: "Bool",
  search_text: "String",
} as const;
export const rawColumns = {
  raw_record_id: "UUID",
  organization_id: "String",
  session_id: "UUID",
  ingest_batch_id: "UUID",
  pos: "Int64",
  source_version: "UInt32",
  key: "Nullable(String)",
  record_type: "String",
  payload: "String",
  redaction_context: "String",
  received_at: "DateTime64(6, 'UTC')",
} as const;
export const fileColumns = {
  organization_id: "String",
  session_id: "UUID",
  file_id: "String",
  path: "String",
  ops: "Array(String)",
} as const;
export const auditColumns = {
  audit_id: "UUID",
  organization_id: "String",
  ts: "DateTime64(6, 'UTC')",
  user_id: "Nullable(String)",
  user_email: "Nullable(String)",
  api_key_id: "Nullable(String)",
  installation_id: "Nullable(UUID)",
  auth_method: "String",
  transport: "String",
  action: "String",
  resource_ids: "Array(String)",
  status_code: "UInt16",
  duration_ms: "UInt32",
  detail: "String",
} as const;
export const chunkColumns = {
  organization_id: "String",
  session_id: "UUID",
  chunk_id: "UUID",
  message_id: "UUID",
  ordinal: "UInt32",
  content: "String",
  content_hash: "String",
  token_count: "UInt32",
  model: "String",
  embedding: "Array(Float32)",
} as const;
export const sessionEmbeddingColumns = {
  organization_id: "String",
  session_id: "UUID",
  model: "String",
  token_count: "UInt32",
  updated_at: "DateTime64(6, 'UTC')",
  embedding: "Array(Float32)",
} as const;
export const receiptColumns = {
  organization_id: "String",
  session_id: "UUID",
  receipt_id: "UUID",
  installation_id: "UUID",
  api_key_id: "String",
  user_id: "String",
  source_pos: "Int64",
  sent_at: "DateTime64(6,'UTC')",
  received_at: "DateTime64(6,'UTC')",
  behavior: "String",
  native_event: "String",
  start_resume: "Bool",
  lifecycle_applied: "Bool",
  accepted_count: "UInt32",
  duplicate_count: "UInt32",
  record_count: "UInt32",
  byte_count: "Int64",
  redaction_count: "UInt32",
  duration_ms: "UInt32",
} as const;
export const receiptRedactionColumns = {
  organization_id: "String",
  session_id: "UUID",
  redaction_id: "String",
  receipt_id: "UUID",
  policy_id: "UUID",
  count: "UInt32",
} as const;
/** Vector width of every stored embedding; the provider, the HNSW index and the row validators share it. */
export const EMBEDDING_DIMENSIONS = 1024;
/** Byte budget of one native page: read pages and insert batches both stay under it. */
export const TRACE_PAGE_BYTES = 8 * 1024 * 1024;

export interface TraceTableDefinition<
  Columns extends Record<string, string> = Record<string, string>,
> {
  readonly columns: Columns;
  /** Column that identifies a row within its session; the highest revision per identity is current. */
  readonly identity: keyof Columns & string;
  /** Declared ClickHouse type of `identity`; keyset cursors over it carry the same type so comparison and ORDER BY agree. */
  readonly identityType: string;
  /** Vector tables publish per embedding epoch and need the embeddings entitlement to read. */
  readonly vector: boolean;
  /** ReplacingMergeTree sorting key: the identity within a session, then generation and revision. */
  readonly keys: readonly string[];
}
function table<Columns extends Record<string, string>>(
  columns: Columns,
  identity: keyof Columns & string,
  options: { vector?: boolean } = {},
): TraceTableDefinition<Columns> {
  const identityType = columns[identity];
  if (identityType === undefined)
    throw new Error(`Unknown identity column ${identity}.`);
  return {
    columns,
    identity,
    identityType,
    vector: options.vector ?? false,
    keys: [
      ...new Set([
        "organization_id",
        "session_id",
        identity,
        "generation",
        "revision",
      ]),
    ],
  };
}
export const traceTables = {
  ingest_receipts: table(receiptColumns, "receipt_id"),
  receipt_redactions: table(receiptRedactionColumns, "redaction_id"),
  sessions: table(sessionColumns, "session_id"),
  messages: table(messageColumns, "message_id"),
  raw_records: table(rawColumns, "raw_record_id"),
  session_files: table(fileColumns, "file_id"),
  message_chunks: table(chunkColumns, "chunk_id", { vector: true }),
  session_embeddings: table(sessionEmbeddingColumns, "session_id", {
    vector: true,
  }),
};
export type TraceTable = keyof typeof traceTables;
