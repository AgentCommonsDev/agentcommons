import type { RedactionStructure } from "../redaction/structure.js";
import type {
  Harness,
  JsonValue,
  MessageKind,
  MessageRole,
  NormalizerContext,
} from "../schemas/common.js";
export type {
  Harness,
  JsonValue,
  NormalizerContext,
} from "../schemas/common.js";
export interface SourceRecord {
  id: string;
  pos: bigint;
  key: string | null;
  sourceVersion: number;
  payload: Record<string, unknown>;
  receivedAt: Date;
  redactionContext?: {
    toolCalls: { idHash: string; sensitive: boolean }[];
    identities: {
      path: (string | number)[];
      idHash: string;
      canonicalId: string;
    }[];
  };
}
export interface NormalizedMessage {
  rawRecordId: string;
  blockIndex: number;
  role: MessageRole;
  kind: MessageKind;
  content: string;
  toolName: string | null;
  toolUseId: string | null;
  toolInput: JsonValue;
  model: string | null;
  timestamp: Date | null;
  inputTokens: bigint | null;
  outputTokens: bigint | null;
  agentId: string | null;
  nativeId: string | null;
  parentId: string | null;
  files?: { path: string; ops: string[] }[];
}
export interface SessionDelta {
  harnessSessionId?: string;
  harnessVersion?: string;
  entrypoint?: string;
  cwd?: string;
  branch?: string;
  repoUrl?: string;
  startCommit?: string;
  model?: string;
  modelsUsed?: string[];
  title?: string;
  firstPrompt?: string;
  startedAt?: Date;
  agentType?: string;
  resumeCount?: number;
}
export interface NativeLink {
  relation: "SUBAGENT" | "FORK";
  parentNativeRef: string;
  agentType?: string;
}
/** A parent transcript's record of the tool call that started one child session. */
export interface NativeSpawn {
  /** The spawning call's native tool-use id, as the parent's `TOOL_USE` message records it. */
  toolUseId: string;
  /** The child's native session reference in the form the child's own upload uses. */
  childNativeRef: string;
}
export interface ResultSource {
  rawRecordId: string;
  toolUseId: string | null;
  locations: { path: (string | number)[]; replacement: JsonValue }[];
}
export interface Normalizer {
  harness: Harness;
  redactionStructure: RedactionStructure;
  nativeIdentities(
    record: SourceRecord,
  ): { id: string; path: (string | number)[] }[];
  toMessages(
    records: readonly SourceRecord[],
    context?: NormalizerContext,
  ): NormalizedMessage[];
  sessionDelta(
    records: readonly SourceRecord[],
    context?: NormalizerContext,
  ): SessionDelta;
  links(records: readonly SourceRecord[]): NativeLink[];
  /** Child sessions this transcript started, keyed by the spawning tool call (§5.5). */
  spawns(records: readonly SourceRecord[]): NativeSpawn[];
  toolUses(records: readonly SourceRecord[]): NormalizedMessage[];
  toolResults(record: SourceRecord): ResultSource[];
  toolIdentities(
    record: SourceRecord,
  ): { id: string; path: (string | number)[] }[];
}
