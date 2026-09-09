import { NORMALIZERS } from "./index.js";
import { SourceNotReadyError } from "./errors.js";
import {
  compareBigInt,
  normalizerContextSchema,
  type Harness,
  type JsonValue,
  type MessageKind,
  type MessageRole,
  type NormalizerContext,
} from "../schemas/common.js";
import {
  messageId,
  repositoryPath,
  searchableMessage,
} from "../metadata/index.js";
import type { SessionDelta, SourceRecord } from "./types.js";

export interface ProjectionSession {
  id: string;
  harness: Harness;
  cwd: string;
  repoRoot: string | null;
  normalizerContext: NormalizerContext;
  projectedContext: NormalizerContext;
}
export interface ResumeReceipt {
  id: string;
  sourcePos: bigint;
  sentAt: Date;
  receivedAt: Date;
}
export interface ProjectedMessage {
  id: string;
  raw_record_id: string | null;
  ingest_batch_id: string | null;
  block_index: number;
  seq: number;
  role: MessageRole;
  kind: MessageKind;
  content: string;
  tool_name: string | null;
  tool_use_id: string | null;
  tool_input: JsonValue;
  model: string | null;
  timestamp: Date | null;
  received_at: Date;
  input_tokens: bigint | null;
  output_tokens: bigint | null;
  agent_id: string | null;
  native_id: string | null;
  parent_native_id: string | null;
  searchable: boolean;
  search_text: string;
}
export interface TraceProjection {
  ready: boolean;
  context: NormalizerContext;
  delta: SessionDelta;
  messages: ProjectedMessage[];
  files: { path: string; ops: string[] }[];
}

/** One pure projection for ingestion, retries and policy rescans, independent of storage. */
export function projectTrace(
  session: ProjectionSession,
  records: readonly SourceRecord[],
  resumes: readonly ResumeReceipt[],
  options: { rescan?: boolean; lifecycle?: boolean } = {},
): TraceProjection | null {
  const normalizer = NORMALIZERS[session.harness];
  let context = normalizerContextSchema.parse(session.normalizerContext);
  let ready = true;
  const normalize = () => normalizer.normalize(records, context);
  let normalized;
  try {
    normalized = normalize();
  } catch (error) {
    if (!(error instanceof SourceNotReadyError)) throw error;
    if (!options.rescan && !options.lifecycle) return null;
    ready = false;
    context = normalizerContextSchema.parse(session.projectedContext);
    try {
      normalized = normalize();
    } catch (fallbackError) {
      if (!(fallbackError instanceof SourceNotReadyError)) throw fallbackError;
      normalized = { messages: [], delta: {} };
    }
  }
  const source = new Map(records.map((record) => [record.id, record]));
  const positions = new Map<
    string,
    { pos: bigint; lifecycle: boolean; time: number; nativeOrder: number }
  >();
  const messages: ProjectedMessage[] = normalized.messages.map(
    (message, seq) => {
      const record = source.get(message.rawRecordId);
      if (!record) throw new Error("Normalized message has no source record.");
      const id = messageId(session.id, record.id, message.blockIndex);
      positions.set(id, {
        pos: record.pos,
        lifecycle: false,
        time: 0,
        nativeOrder: seq,
      });
      const search = searchableMessage(message);
      return {
        id,
        raw_record_id: record.id,
        ingest_batch_id: null,
        block_index: message.blockIndex,
        seq,
        role: message.role,
        kind: message.kind,
        content: message.content,
        tool_name: message.toolName,
        tool_use_id: message.toolUseId,
        tool_input: message.toolInput,
        model: message.model,
        timestamp: message.timestamp,
        received_at: record.receivedAt,
        input_tokens: message.inputTokens,
        output_tokens: message.outputTokens,
        agent_id: message.agentId,
        native_id: message.nativeId,
        parent_native_id: message.parentId,
        searchable: search.searchable,
        search_text: search.searchText,
      };
    },
  );
  for (const receipt of resumes) {
    const id = messageId(session.id, `resume:${receipt.id}`, 0);
    messages.push({
      id,
      raw_record_id: null,
      ingest_batch_id: receipt.id,
      seq: 0,
      block_index: 0,
      role: "SYSTEM",
      kind: "META",
      content: "Session resumed.",
      tool_name: null,
      tool_use_id: null,
      tool_input: null,
      model: null,
      timestamp: receipt.sentAt,
      received_at: receipt.receivedAt,
      input_tokens: null,
      output_tokens: null,
      agent_id: null,
      native_id: null,
      parent_native_id: null,
      searchable: false,
      search_text: "",
    });
    positions.set(id, {
      pos: receipt.sourcePos,
      lifecycle: true,
      time: receipt.sentAt.getTime(),
      nativeOrder: 0,
    });
  }
  messages.sort((left, right) => {
    const a = positions.get(left.id);
    const b = positions.get(right.id);
    if (!a || !b)
      throw new Error("A projected message has no source ordering metadata.");
    return (
      compareBigInt(a.pos, b.pos) ||
      Number(a.lifecycle) - Number(b.lifecycle) ||
      a.nativeOrder - b.nativeOrder ||
      a.time - b.time ||
      left.id.localeCompare(right.id)
    );
  });
  messages.forEach((message, seq) => {
    message.seq = seq;
  });
  const files = new Map<string, Set<string>>();
  for (const message of normalized.messages)
    for (const file of message.files ?? []) {
      const path = repositoryPath(file.path, session.repoRoot, session.cwd);
      if (path === null) continue;
      const operations = files.get(path) ?? new Set<string>();
      for (const operation of file.ops) operations.add(operation);
      files.set(path, operations);
    }
  return {
    ready,
    context,
    delta: normalized.delta,
    messages,
    files: [...files].map(([path, ops]) => ({ path, ops: [...ops].sort() })),
  };
}
