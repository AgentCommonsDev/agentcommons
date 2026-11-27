import {
  protocolArray,
  protocolLiterals,
  protocolObject,
} from "../redaction/structure.js";
import {
  array,
  assignPresent,
  assignUsage,
  createNormalizer,
  identitiesAt,
  json,
  message,
  object,
  string,
  text,
  timestamp,
  tokens,
  toolFiles,
  SENSITIVE_FILE_MARKER,
} from "./shared.js";
import type {
  JsonValue,
  NativeSpawn,
  NormalizedMessage,
  SessionDelta,
  SourceRecord,
} from "./types.js";

/**
 * The opencode plugin writes one JSON document per session (§5.4): session facts at the
 * top and a `messages` array in the engine's own shape. opencode 1.x stores a message as
 * `{ info, parts[] }`; opencode 2.x stores a flat message with a `type`. The shape is read
 * from each record, never from the version number, so one document may hold either.
 */
const fileRules = {
  read: { paths: ["filePath", "path"], ops: ["read"] },
  write: { paths: ["filePath", "path"], ops: ["write"] },
  edit: { paths: ["filePath", "path"], ops: ["edit"] },
};
/** The tools that start a child session; their result metadata names the child (§5.5). */
const subagentTools = new Set(["task", "subagent"]);
/** 2.x message types that record a setting change; projected as metadata rows. */
const switchTypes = new Set([
  "agent-switched",
  "model-switched",
  "location-switched",
]);

type Shape =
  | { generation: 1; info: Record<string, unknown>; parts: unknown[] }
  | { generation: 2; message: Record<string, unknown> };
function shapeOf(record: SourceRecord): Shape | null {
  const data = record.payload;
  if (typeof data.info === "object" && Array.isArray(data.parts))
    return { generation: 1, info: object(data.info), parts: data.parts };
  if (typeof data.type === "string") return { generation: 2, message: data };
  return null;
}
/** Cached tokens are input; reasoning tokens are output, as for the other harnesses. */
function usage(value: unknown): {
  input: bigint | null;
  output: bigint | null;
} {
  const counts = object(value);
  const cache = object(counts.cache);
  const input = tokens(counts.input);
  const output = tokens(counts.output);
  return {
    input:
      input === null
        ? null
        : input + (tokens(cache.read) ?? 0n) + (tokens(cache.write) ?? 0n),
    output: output === null ? null : output + (tokens(counts.reasoning) ?? 0n),
  };
}
/** A tool call and, once it finished, its result; both engines keep them in one entry. */
function toolMessages(
  record: SourceRecord,
  blockIndex: number,
  call: {
    id: string | null;
    name: string | null;
    state: Record<string, unknown>;
    result: string | null;
    finishedAt: Date | null;
  },
  defaults: Partial<NormalizedMessage>,
): NormalizedMessage[] {
  const toolInput: JsonValue = json(call.state.input);
  const use = message(record, blockIndex, {
    ...defaults,
    role: "ASSISTANT",
    kind: "TOOL_USE",
    content: "",
    toolName: call.name,
    toolUseId: call.id,
    toolInput,
    files: toolFiles(call.name, toolInput, fileRules),
  });
  if (call.result === null) return [use];
  return [
    use,
    message(record, blockIndex + 1, {
      ...defaults,
      role: "TOOL_RESULT",
      kind: "TOOL_RESULT",
      content: call.result,
      toolName: call.name,
      toolUseId: call.id,
      timestamp: call.finishedAt ?? defaults.timestamp ?? null,
    }),
  ];
}
/** The result text of a finished call, or null while it is pending or running. */
function resultText(state: Record<string, unknown>): string | null {
  if (state.status === "completed")
    return text(state.output ?? state.content ?? "");
  if (state.status === "error") {
    const error = object(state.error);
    return string(state.error) ?? string(error.message) ?? text(state.error);
  }
  return null;
}
function generationOne(
  record: SourceRecord,
  info: Record<string, unknown>,
  parts: readonly unknown[],
): NormalizedMessage[] {
  const role = info.role === "assistant" ? "ASSISTANT" : "USER";
  const defaults: Partial<NormalizedMessage> = {
    model: role === "ASSISTANT" ? string(info.modelID) : null,
    timestamp: timestamp(object(info.time).created),
    nativeId: string(info.id),
    parentId: string(info.parentID),
    agentId: null,
  };
  const result: NormalizedMessage[] = [];
  let blockIndex = 0;
  for (const value of parts) {
    const part = object(value);
    if (part.type === "text" && part.ignored !== true)
      result.push(
        message(record, blockIndex++, {
          ...defaults,
          role: part.synthetic === true ? "SYSTEM" : role,
          kind: "TEXT",
          content: text(part.text),
        }),
      );
    else if (part.type === "reasoning")
      result.push(
        message(record, blockIndex++, {
          ...defaults,
          role: "ASSISTANT",
          kind: "THINKING",
          content: text(part.text),
        }),
      );
    else if (part.type === "file")
      result.push(
        message(record, blockIndex++, {
          ...defaults,
          role,
          kind: "META",
          content:
            `[file] ${string(part.filename) ?? string(part.url) ?? ""}`.trim(),
        }),
      );
    else if (part.type === "tool") {
      const state = object(part.state);
      const produced = toolMessages(
        record,
        blockIndex,
        {
          id: string(part.callID),
          name: string(part.tool),
          state,
          result: resultText(state),
          finishedAt: timestamp(object(state.time).end),
        },
        defaults,
      );
      result.push(...produced);
      blockIndex += produced.length;
    }
  }
  const counts = usage(info.tokens);
  assignUsage(result, counts.input, counts.output);
  return result;
}
function generationTwo(
  record: SourceRecord,
  data: Record<string, unknown>,
): NormalizedMessage[] {
  const type = string(data.type) ?? "";
  const defaults: Partial<NormalizedMessage> = {
    timestamp: timestamp(object(data.time).created),
    nativeId: string(data.id),
    parentId: null,
    agentId: null,
  };
  if (type === "user")
    return [
      message(record, 0, {
        ...defaults,
        role: "USER",
        kind: "TEXT",
        content: text(data.text),
      }),
      ...array(data.files).map((file, index) =>
        message(record, index + 1, {
          ...defaults,
          role: "USER",
          kind: "META",
          content: `[file] ${text(object(file).filename ?? object(file).url ?? file)}`,
        }),
      ),
    ];
  // Text the harness injects into the conversation, such as a subagent's report.
  if (type === "synthetic")
    return [
      message(record, 0, {
        ...defaults,
        role: "SYSTEM",
        kind: "TEXT",
        content: text(data.text),
      }),
    ];
  if (type === "compaction")
    return [
      message(record, 0, {
        ...defaults,
        role: "SYSTEM",
        kind: "TEXT",
        content: text(data.summary),
        model: string(object(data.model).id),
      }),
    ];
  if (switchTypes.has(type))
    return [message(record, 0, { ...defaults, content: text(data) })];
  if (type !== "assistant") return [];
  const assistant = { ...defaults, model: string(object(data.model).id) };
  const result: NormalizedMessage[] = [];
  let blockIndex = 0;
  for (const value of array(data.content)) {
    const block = object(value);
    if (block.type === "text")
      result.push(
        message(record, blockIndex++, {
          ...assistant,
          role: "ASSISTANT",
          kind: "TEXT",
          content: text(block.text),
        }),
      );
    else if (block.type === "reasoning")
      result.push(
        message(record, blockIndex++, {
          ...assistant,
          role: "ASSISTANT",
          kind: "THINKING",
          content: text(block.text),
        }),
      );
    else if (block.type === "tool") {
      const state = object(block.state);
      const produced = toolMessages(
        record,
        blockIndex,
        {
          id: string(block.id),
          name: string(block.name),
          state,
          result: resultText(state),
          finishedAt: timestamp(object(block.time).completed),
        },
        assistant,
      );
      result.push(...produced);
      blockIndex += produced.length;
    }
  }
  const counts = usage(data.tokens);
  assignUsage(result, counts.input, counts.output);
  return result;
}
/** Where each tool call of a record lives, as `[path to its entry, the entry]`. */
function toolEntries(record: SourceRecord): {
  path: (string | number)[];
  id: string | null;
  entry: Record<string, unknown>;
}[] {
  const shape = shapeOf(record);
  if (shape?.generation === 1)
    return shape.parts.flatMap((value, index) => {
      const part = object(value);
      return part.type === "tool"
        ? [{ path: ["parts", index], id: string(part.callID), entry: part }]
        : [];
    });
  if (shape?.generation === 2 && shape.message.type === "assistant")
    return array(shape.message.content).flatMap((value, index) => {
      const block = object(value);
      return block.type === "tool"
        ? [{ path: ["content", index], id: string(block.id), entry: block }]
        : [];
    });
  return [];
}
const toolState = protocolObject([], {
  status: protocolLiterals("pending", "running", "completed", "error"),
  time: protocolObject(["start", "end", "compacted"]),
});
const tokenCounts = protocolObject(["input", "output", "reasoning", "total"], {
  cache: protocolObject(["read", "write"]),
});
const time = protocolObject([
  "created",
  "completed",
  "firstToken",
  "streamed",
  "ran",
  "start",
  "end",
]);
export const opencode = createNormalizer({
  harness: "OPENCODE",
  redactionStructure: protocolObject(
    ["id", "cost", "finish", "rawFinish", "agent", "outcome", "executed"],
    {
      type: protocolLiterals(
        "user",
        "assistant",
        "synthetic",
        "system",
        "skill",
        "shell",
        "compaction",
        "idle",
        "agent-switched",
        "model-switched",
        "location-switched",
      ),
      time,
      tokens: tokenCounts,
      model: protocolObject(["id", "providerID", "variant"]),
      content: protocolArray(
        protocolObject(["id", "name", "executed"], {
          type: protocolLiterals("text", "reasoning", "tool"),
          state: toolState,
          time,
        }),
      ),
      info: protocolObject(
        [
          "id",
          "sessionID",
          "parentID",
          "modelID",
          "providerID",
          "mode",
          "agent",
          "cost",
          "finish",
        ],
        {
          role: protocolLiterals("user", "assistant"),
          time,
          tokens: tokenCounts,
        },
      ),
      parts: protocolArray(
        protocolObject(["id", "sessionID", "messageID", "callID", "tool"], {
          type: protocolLiterals(
            "text",
            "reasoning",
            "tool",
            "file",
            "step-start",
            "step-finish",
            "snapshot",
            "patch",
            "agent",
            "retry",
            "compaction",
            "subtask",
          ),
          state: toolState,
          time,
          tokens: tokenCounts,
        }),
      ),
    },
  ),
  nativeIdentities(record) {
    return identitiesAt(record, [["id"], ["info", "id"], ["info", "parentID"]]);
  },
  versioned: true,
  toolIdentities(record) {
    return toolEntries(record).flatMap(({ path, id, entry }) =>
      id ? [{ id, path: [...path, "callID" in entry ? "callID" : "id"] }] : [],
    );
  },
  toolResults(record) {
    return toolEntries(record).flatMap(({ path, id, entry }) => {
      const state = object(entry.state);
      if (state.status !== "completed" && state.status !== "error") return [];
      const output =
        "content" in state
          ? { content: [{ type: "text", text: SENSITIVE_FILE_MARKER }] }
          : { output: SENSITIVE_FILE_MARKER };
      return [
        {
          toolUseId: id,
          locations: [
            {
              path: [...path, "state"],
              replacement: {
                status: "completed",
                input: json(state.input),
                ...output,
              },
            },
          ],
        },
      ];
    });
  },
  toMessages(records) {
    return records.flatMap((record) => {
      const shape = shapeOf(record);
      if (!shape) return [];
      return shape.generation === 1
        ? generationOne(record, shape.info, shape.parts)
        : generationTwo(record, shape.message);
    });
  },
  sessionDelta(_records, context) {
    const delta: SessionDelta = {};
    const session = object(context?.transcriptMetadata);
    assignPresent(delta, {
      harnessSessionId: string(session.sessionId),
      harnessVersion: string(session.harnessVersion),
      cwd: string(session.directory),
      title: string(session.title),
      startedAt: timestamp(session.startedAt),
      agentType: string(session.agent),
    });
    return delta;
  },
  // A child's document names its parent only in session facts, which the hook sends as the
  // SUBAGENT parent hint (§5.5); no record of its own does.
  links() {
    return [];
  },
  spawns(records) {
    return records.flatMap((record) =>
      toolEntries(record).flatMap(({ id, entry }): NativeSpawn[] => {
        const name = string(entry.tool) ?? string(entry.name);
        const metadata = object(object(entry.state).metadata);
        const child = string(metadata.sessionId) ?? string(metadata.sessionID);
        return id && name && subagentTools.has(name) && child
          ? [{ toolUseId: id, childNativeRef: child }]
          : [];
      }),
    );
  },
});
