import {
  projectionIdentity,
  projectionRecord,
  valueAt,
} from "../redaction/tool-results.js";
import { z } from "zod";
import { SourceNotReadyError } from "./errors.js";
import { truncateUtf8 } from "../metadata/index.js";
import { compareBigInt } from "../schemas/common.js";
import type {
  JsonValue,
  NormalizedMessage,
  Normalizer,
  NormalizerContext,
  SessionDelta,
  SourceRecord,
} from "./types.js";

/** The record's own object, or an empty one; arrays and primitives read as no fields. */
export function object(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function array(value: unknown): unknown[] {
  return Array.isArray(value) ? (value as unknown[]) : [];
}
export function string(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
export function timestamp(value: unknown): Date | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}
export function tokens(value: unknown): bigint | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? BigInt(value)
    : null;
}
export function json(value: unknown): JsonValue {
  const parsed = z.json().safeParse(value);
  return parsed.success ? parsed.data : null;
}
export function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value))
    return (value as unknown[]).map(text).filter(Boolean).join("\n");
  const data = object(value);
  if (typeof data.text === "string") return data.text;
  if (typeof data.output === "string") return data.output;
  if (typeof data.content === "string" || Array.isArray(data.content))
    return text(data.content);
  return value === undefined || value === null
    ? ""
    : JSON.stringify(json(value));
}
export function message(
  record: SourceRecord,
  blockIndex: number,
  fields: Partial<NormalizedMessage>,
): NormalizedMessage {
  return {
    rawRecordId: record.id,
    blockIndex,
    role: "SYSTEM",
    kind: "META",
    content: "",
    toolName: null,
    toolUseId: null,
    toolInput: null,
    model: null,
    timestamp: timestamp(record.payload.timestamp),
    inputTokens: null,
    outputTokens: null,
    agentId: string(record.payload.agentId),
    nativeId: string(record.payload.id),
    parentId: string(record.payload.parentId),
    ...fields,
  };
}
/** Native role or record type to canonical role; a value outside the table is not a message. */
export type NativeRoles = Readonly<Record<string, NormalizedMessage["role"]>>;
/** Copy each truthy value onto the delta so absent native fields keep what earlier records set. */
export function assignPresent<T extends object>(
  target: T,
  values: { [K in keyof T]?: T[K] | null },
): void {
  for (const key of Object.keys(values) as (keyof T)[]) {
    const value = values[key];
    if (value) target[key] = value;
  }
}
export interface BlockDialect {
  textTypes: readonly string[];
  thinkingTypes: readonly string[];
  /** Tool calls carried inline as content blocks, when the dialect has them. */
  toolUse?: { types: readonly string[]; inputKey: string };
  /** Tool results carried inline as content blocks, when the dialect has them. */
  toolResult?: { types: readonly string[]; idKey: string };
}
export const anthropicBlocks: BlockDialect = {
  textTypes: ["text"],
  thinkingTypes: ["thinking"],
  toolUse: { types: ["tool_use"], inputKey: "input" },
  toolResult: { types: ["tool_result"], idKey: "tool_use_id" },
};
export function blocks(
  record: SourceRecord,
  content: unknown,
  role: NormalizedMessage["role"],
  dialect: BlockDialect,
  defaults: Partial<NormalizedMessage> = {},
): NormalizedMessage[] {
  if (typeof content === "string")
    return [message(record, 0, { ...defaults, role, kind: "TEXT", content })];
  return array(content).flatMap((value, blockIndex) => {
    const block = object(value);
    const type = string(block.type) ?? "";
    const base = { ...defaults, role };
    if (dialect.textTypes.includes(type))
      return [
        message(record, blockIndex, {
          ...base,
          kind: "TEXT",
          content: text(block.text),
        }),
      ];
    if (dialect.thinkingTypes.includes(type))
      return [
        message(record, blockIndex, {
          ...base,
          kind: "THINKING",
          content: text(block.thinking ?? block.text),
        }),
      ];
    if (dialect.toolUse?.types.includes(type))
      return [
        message(record, blockIndex, {
          ...base,
          kind: "TOOL_USE",
          content: "",
          toolName: string(block.name),
          toolUseId: string(block.id),
          toolInput: json(block[dialect.toolUse.inputKey]),
        }),
      ];
    if (dialect.toolResult?.types.includes(type))
      return [
        message(record, blockIndex, {
          ...base,
          role: "TOOL_RESULT",
          kind: "TOOL_RESULT",
          content: text(block.content),
          toolUseId: string(block[dialect.toolResult.idKey]),
          toolName: string(block.toolName),
        }),
      ];
    if (type === "image")
      return [
        message(record, blockIndex, {
          ...base,
          kind: "META",
          content: "[image]",
        }),
      ];
    return [];
  });
}
export function advanceCumulativeUsage(
  value: bigint | null,
  previous: bigint,
): { delta: bigint | null; total: bigint } {
  if (value === null) return { delta: null, total: previous };
  const total = value > previous ? value : previous;
  return { delta: total - previous, total };
}
export function assignUsage(
  messages: NormalizedMessage[],
  input: bigint | null,
  output: bigint | null,
): void {
  const first = messages[0];
  if (first) {
    first.inputTokens = input;
    first.outputTokens = output;
  }
}
function order(records: readonly SourceRecord[]): SourceRecord[] {
  // The durable identity digest breaks ties only between records sharing a position and
  // version, so it is hashed on demand rather than once per record.
  const identities = new Map<string, string>();
  const identity = (record: SourceRecord): string => {
    let value = identities.get(record.id);
    if (value === undefined) {
      value = record.key === null ? "" : projectionIdentity(record.key);
      identities.set(record.id, value);
    }
    return value;
  };
  return [...records].sort(
    (a, b) =>
      compareBigInt(a.pos, b.pos) ||
      a.sourceVersion - b.sourceVersion ||
      identity(a).localeCompare(identity(b)) ||
      a.id.localeCompare(b.id),
  );
}
function latestVersions(records: readonly SourceRecord[]): SourceRecord[] {
  const latest = new Map<bigint, SourceRecord>();
  for (const record of order(records)) latest.set(record.pos, record);
  return [...latest.values()];
}
function activeBranch(
  records: readonly SourceRecord[],
  context: NormalizerContext,
): SourceRecord[] {
  const byId = new Map(
    records
      .filter((r) => r.payload.type !== "session")
      .map((r) => [string(r.payload.id), r]),
  );
  const lastLeaf = records.reduce<string | null>(
    (leaf, record) =>
      record.payload.type === "session"
        ? leaf
        : (string(record.payload.id) ?? leaf),
    null,
  );
  let leaf =
    context.activeLeafId === undefined ? lastLeaf : context.activeLeafId;
  const selected = new Set<SourceRecord>();
  while (leaf) {
    const record = byId.get(leaf);
    if (!record) throw new SourceNotReadyError(leaf);
    if (selected.has(record))
      throw new Error("The transcript branch contains a parent cycle.");
    selected.add(record);
    leaf = string(record.payload.parentId);
  }
  return records.filter((r) => r.payload.type === "session" || selected.has(r));
}
interface FileRule {
  paths: readonly string[];
  ops: string[];
}
export function toolFiles(
  name: string | null,
  input: JsonValue,
  rules: Readonly<Record<string, FileRule>>,
): { path: string; ops: string[] }[] {
  const rule = name ? rules[name] : undefined;
  if (!rule) return [];
  const data = object(input);
  return rule.paths.flatMap((key) => {
    const path = string(data[key]);
    return path ? [{ path, ops: [...rule.ops] }] : [];
  });
}
function baseDelta(messages: readonly NormalizedMessage[]): SessionDelta {
  const first = messages.find((m) => m.role === "USER" && m.kind === "TEXT");
  const modelsUsed = [
    ...new Set(messages.flatMap((m) => (m.model ? [m.model] : []))),
  ];
  const model = modelsUsed.at(-1);
  return {
    ...(first
      ? {
          firstPrompt: truncateUtf8(first.content, 4096),
          title: first.content.slice(0, 120),
        }
      : {}),
    modelsUsed,
    ...(model ? { model } : {}),
  };
}
export const SENSITIVE_FILE_MARKER =
  "[agentcommons: sensitive file output redacted]";

export function createNormalizer(
  config: Omit<Normalizer, "toolUses" | "normalize"> & {
    versioned?: boolean;
    tree?: boolean;
  },
): Normalizer {
  const prepare = config.versioned ? latestVersions : order;
  const messagesOf = (
    prepared: readonly SourceRecord[],
    records: readonly SourceRecord[],
    context: NormalizerContext,
  ): NormalizedMessage[] => {
    const projected = prepared.map(projectionRecord);
    const projectionContext =
      context.activeLeafId &&
      records.some((record) => record.redactionContext?.identities.length)
        ? { ...context, activeLeafId: projectionIdentity(context.activeLeafId) }
        : context;
    const result = config.toMessages(
      config.tree ? activeBranch(projected, projectionContext) : projected,
      projectionContext,
    );
    const names = new Map(
      result
        .filter((m) => m.kind === "TOOL_USE" && m.toolUseId)
        .map((m) => [m.toolUseId, m.toolName]),
    );
    for (const item of result)
      if (item.kind === "TOOL_RESULT" && !item.toolName)
        item.toolName = names.get(item.toolUseId) ?? null;
    return result;
  };
  const normalize: Normalizer["normalize"] = (records, context = {}) => {
    const prepared = prepare(records);
    const messages = messagesOf(prepared, records, context);
    return {
      messages,
      delta: {
        ...baseDelta(messages),
        ...config.sessionDelta(prepared, context),
      },
    };
  };
  return {
    harness: config.harness,
    redactionStructure: config.redactionStructure,
    nativeIdentities: config.nativeIdentities,
    normalize,
    toMessages: (records, context = {}) =>
      messagesOf(prepare(records), records, context),
    sessionDelta: (records, context) => normalize(records, context).delta,
    links: (records) => config.links(prepare(records)),
    spawns: (records) => config.spawns(prepare(records)),
    toolUses: (records) =>
      config
        .toMessages(order(records))
        .filter((item) => item.kind === "TOOL_USE"),
    toolResults: config.toolResults,
    toolIdentities: config.toolIdentities,
  };
}

export function identitiesAt(
  record: SourceRecord,
  paths: readonly (readonly (string | number)[])[],
): { id: string; path: (string | number)[] }[] {
  return paths.flatMap((path) => {
    const id = string(valueAt(record.payload, path));
    return id ? [{ id, path: [...path] }] : [];
  });
}
