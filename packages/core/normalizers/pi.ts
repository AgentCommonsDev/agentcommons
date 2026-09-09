import {
  protocolArray,
  protocolLiterals,
  protocolObject,
  protocolTimestamp,
} from "../redaction/structure.js";
import {
  array,
  assignPresent,
  identitiesAt,
  assignUsage,
  blocks,
  createNormalizer,
  message,
  object,
  string,
  text,
  timestamp,
  tokens,
  toolFiles,
  SENSITIVE_FILE_MARKER,
  type NativeRoles,
} from "./shared.js";
import type { BlockDialect } from "./shared.js";
import type { NativeLink, SessionDelta } from "./types.js";

/** pi carries tool results as whole `toolResult` messages, never as content blocks. */
const dialect: BlockDialect = {
  textTypes: ["text"],
  thinkingTypes: ["thinking"],
  toolUse: { types: ["toolCall"], inputKey: "arguments" },
};
const fileRules = {
  read: { paths: ["path"], ops: ["read"] },
  edit: { paths: ["path"], ops: ["edit"] },
  write: { paths: ["path"], ops: ["write"] },
};
/** Message roles that carry content blocks; `toolResult` and `bashExecution` are handled whole. */
const nativeRoles: NativeRoles = {
  user: "USER",
  assistant: "ASSISTANT",
  custom: "SYSTEM",
};
/** Record types projected as metadata rows with their JSON as text. */
const metadataTypes = new Set([
  "model_change",
  "thinking_level_change",
  "custom",
  "label",
  "session_info",
]);
export const pi = createNormalizer({
  harness: "PI",
  redactionStructure: protocolObject(
    [
      "id",
      "parentId",
      "parentSession",
      "timestamp",
      "cwd",
      "modelId",
      "name",
      "summary",
      "content",
      "thinkingLevel",
      "label",
      "customType",
      "data",
    ],
    {
      timestamp: protocolTimestamp,
      type: protocolLiterals(
        "session",
        "message",
        "model_change",
        "thinking_level_change",
        "custom",
        "label",
        "session_info",
        "compaction",
        "branch_summary",
        "custom_message",
      ),
      message: protocolObject(
        ["model", "toolCallId", "toolName", "timestamp", "output"],
        {
          timestamp: protocolTimestamp,
          role: protocolLiterals(
            "user",
            "assistant",
            "custom",
            "toolResult",
            "bashExecution",
          ),
          usage: protocolObject(["input", "output", "cacheRead", "cacheWrite"]),
          content: protocolArray(
            protocolObject(["id", "name", "arguments", "text", "thinking"], {
              type: protocolLiterals("text", "thinking", "toolCall", "image"),
            }),
          ),
        },
      ),
    },
  ),
  nativeIdentities(record) {
    return identitiesAt(record, [["id"], ["parentId"], ["parentSession"]]).map(
      (location) => ({
        ...location,
        id:
          location.path[0] === "parentSession"
            ? parentSessionId(location.id)
            : location.id,
      }),
    );
  },
  tree: true,
  toolIdentities(record) {
    const native = object(record.payload.message);
    const result = array(native.content).flatMap((value, index) => {
      const block = object(value);
      const id = block.type === "toolCall" ? string(block.id) : null;
      return id ? [{ id, path: ["message", "content", index, "id"] }] : [];
    });
    const id = native.role === "toolResult" ? string(native.toolCallId) : null;
    if (id) result.push({ id, path: ["message", "toolCallId"] });
    return result;
  },
  toolResults(record) {
    const native = object(record.payload.message);
    if (record.payload.type !== "message" || native.role !== "toolResult")
      return [];
    const id = string(native.toolCallId);
    return [
      {
        toolUseId: id,
        locations: [
          {
            path: ["message"],
            replacement: {
              role: "toolResult",
              toolCallId: id,
              toolName: string(native.toolName),
              timestamp:
                typeof native.timestamp === "number" ||
                typeof native.timestamp === "string"
                  ? native.timestamp
                  : null,
              content: [{ type: "text", text: SENSITIVE_FILE_MARKER }],
            },
          },
        ],
      },
    ];
  },
  toMessages(records) {
    let model: string | null = null;
    return records.flatMap((record) => {
      const data = record.payload;
      const type = string(data.type);
      if (type === null) return [];
      if (type === "model_change") model = string(data.modelId);
      if (metadataTypes.has(type))
        return [message(record, 0, { content: text(data), model })];
      if (type === "compaction" || type === "branch_summary")
        return [
          message(record, 0, {
            kind: "TEXT",
            content: text(data.summary),
            model,
          }),
        ];
      if (type === "custom_message")
        return [
          message(record, 0, {
            kind: "TEXT",
            content: text(data.content),
            model,
          }),
        ];
      if (type !== "message") return [];
      const native = object(data.message);
      const currentModel = string(native.model) ?? model;
      const sourceTime =
        timestamp(native.timestamp) ?? timestamp(data.timestamp);
      if (native.role === "toolResult")
        return [
          message(record, 0, {
            role: "TOOL_RESULT",
            kind: "TOOL_RESULT",
            content: text(native.content),
            toolName: string(native.toolName),
            toolUseId: string(native.toolCallId),
            timestamp: sourceTime,
            model: currentModel,
          }),
        ];
      if (native.role === "bashExecution")
        return [
          message(record, 0, {
            role: "TOOL_RESULT",
            kind: "TOOL_RESULT",
            content: text(native.output),
            toolName: "bash",
            timestamp: sourceTime,
            model: currentModel,
          }),
        ];
      const role = nativeRoles[string(native.role) ?? ""];
      if (!role) return [];
      const result = blocks(record, native.content, role, dialect, {
        model: currentModel,
        timestamp: sourceTime,
      });
      for (const item of result)
        if (item.kind === "TOOL_USE")
          item.files = toolFiles(item.toolName, item.toolInput, fileRules);
      const usage = object(native.usage);
      let input = tokens(usage.input);
      if (input !== null)
        input +=
          (tokens(usage.cacheRead) ?? 0n) + (tokens(usage.cacheWrite) ?? 0n);
      assignUsage(result, input, tokens(usage.output));
      return result;
    });
  },
  sessionDelta(records, context) {
    const delta: SessionDelta = {};
    // The transcript has no host version or mode; the extension reports them per process.
    const host = object(context?.transcriptMetadata);
    assignPresent(delta, {
      harnessVersion: string(host.harnessVersion),
      entrypoint: string(host.entrypoint),
    });
    for (const { payload: data } of records) {
      if (data.type === "session")
        assignPresent(delta, {
          harnessSessionId: string(data.id),
          cwd: string(data.cwd),
          startedAt: timestamp(data.timestamp),
        });
      if (data.type === "session_info")
        assignPresent(delta, { title: string(data.name) });
    }
    return delta;
  },
  links(records) {
    const links: NativeLink[] = [];
    for (const { payload: data } of records) {
      if (data.type !== "session") continue;
      const parent = string(data.parentSession);
      if (!parent) continue;
      links.push({
        relation: "FORK",
        parentNativeRef: parentSessionId(parent),
      });
    }
    return links;
  },
  // A fork records its parent file, never a tool call; nothing spawns a pi child.
  spawns() {
    return [];
  },
});

function parentSessionId(parent: string): string {
  return (
    /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i.exec(
      parent,
    )?.[1] ?? parent
  );
}
