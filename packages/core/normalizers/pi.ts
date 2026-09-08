import {
  protocolArray,
  protocolLiterals,
  protocolObject,
  protocolTimestamp,
} from "../redaction/structure.js";
import {
  array,
  identitiesAt,
  assignUsage,
  blocks,
  createNormalizer,
  message,
  object,
  recordSchema,
  string,
  text,
  timestamp,
  tokens,
  toolFiles,
  SENSITIVE_FILE_MARKER,
} from "./shared.js";
import type { BlockDialect } from "./shared.js";
import type { NativeLink, SessionDelta } from "./types.js";

const dialect: BlockDialect = {
  textTypes: ["text"],
  thinkingTypes: ["thinking"],
  toolUseTypes: ["toolCall"],
  toolResultTypes: [],
  toolInput: "arguments",
  toolResultId: "toolCallId",
};
const fileRules = {
  read: { paths: ["path"], ops: ["read"] },
  edit: { paths: ["path"], ops: ["edit"] },
  write: { paths: ["path"], ops: ["write"] },
};
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
        rawRecordId: record.id,
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
      const parsed = recordSchema.safeParse(record.payload);
      if (!parsed.success) return [];
      const data = parsed.data;
      if (data.type === "model_change") model = string(data.modelId);
      if (
        [
          "model_change",
          "thinking_level_change",
          "custom",
          "label",
          "session_info",
        ].includes(data.type)
      )
        return [message(record, 0, { content: text(data), model })];
      if (data.type === "compaction" || data.type === "branch_summary")
        return [
          message(record, 0, {
            kind: "TEXT",
            content: text(data.summary),
            model,
          }),
        ];
      if (data.type === "custom_message")
        return [
          message(record, 0, {
            kind: "TEXT",
            content: text(data.content),
            model,
          }),
        ];
      if (data.type !== "message") return [];
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
      if (!["user", "assistant", "custom"].includes(string(native.role) ?? ""))
        return [];
      const role =
        native.role === "user"
          ? "USER"
          : native.role === "assistant"
            ? "ASSISTANT"
            : "SYSTEM";
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
  sessionDelta(records) {
    const delta: SessionDelta = {};
    for (const { payload: data } of records) {
      if (data.type === "session") {
        const id = string(data.id);
        if (id) delta.harnessSessionId = id;
        const cwd = string(data.cwd);
        if (cwd) delta.cwd = cwd;
        const time = timestamp(data.timestamp);
        if (time) delta.startedAt = time;
      }
      if (data.type === "session_info") {
        const name = string(data.name);
        if (name) delta.title = name;
      }
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
});

function parentSessionId(parent: string): string {
  return (
    /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i.exec(
      parent,
    )?.[1] ?? parent
  );
}
