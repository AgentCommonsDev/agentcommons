import type { Prisma } from "@agentcommons/db";
import type {
  ProjectedMessage,
  SourceRecord,
  JsonValue,
  Harness,
} from "@agentcommons/core";

export interface TraceScope {
  organizationId: string;
  sessionId: string;
  /** Positive PostgreSQL source revision (or independent vector epoch), without JS precision loss. */
  revision: bigint;
  /** Current redaction generation; older generations are never reader-visible. */
  generation: bigint;
}
export interface TraceRawRecord extends SourceRecord {
  ingestBatchId: string;
  recordType: string;
}
export interface TraceSession {
  session_id: string;
  organization_id: string;
  harness: Harness;
  harness_session_id: string;
  harness_version: string | null;
  entrypoint: string | null;
  user_id: string;
  ingest_api_key_id: string;
  installation_id: string;
  cwd: string;
  repo_root: string | null;
  cwd_relative: string | null;
  repo_url: string | null;
  repo_name: string | null;
  branch: string | null;
  start_commit: string | null;
  end_commit: string | null;
  observed_commits: JsonValue;
  observed_diff_stat: JsonValue;
  dirty_file_count: number | null;
  model: string | null;
  models_used: string[];
  started_at: Date;
  ended_at: Date | null;
  last_activity_at: Date;
  status: "ACTIVE" | "ENDED" | "INACTIVE";
  end_reason: string | null;
  title: string | null;
  first_prompt: string | null;
  parent_session_id: string | null;
  parent_relation: "SUBAGENT" | "FORK" | "SPAWNED" | null;
  parent_native_ref: string | null;
  agent_type: string | null;
  message_count: number;
  tool_call_count: number;
  input_tokens: bigint;
  output_tokens: bigint;
  tools_used: string[];
}
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

export interface TraceEmbeddingChunk {
  id: string;
  messageId: string;
  ordinal: number;
  content: string;
  contentHash: string;
  tokenCount: number;
  model: string;
  embedding: number[];
}
export interface TraceEmbeddingWrite {
  chunks: readonly TraceEmbeddingChunk[];
  session: { model: string; tokenCount: number; embedding: number[] } | null;
  updatedAt: Date;
}
