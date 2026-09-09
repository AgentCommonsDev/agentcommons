import { posix } from "node:path";
import {
  protocolArray,
  protocolLiterals,
  protocolObject,
  protocolTimestamp,
} from "../redaction/structure.js";
import { uniqueBy } from "../schemas/common.js";
import {
  advanceCumulativeUsage,
  array,
  assignPresent,
  identitiesAt,
  blocks,
  createNormalizer,
  json,
  message,
  object,
  string,
  text,
  timestamp,
  tokens,
  SENSITIVE_FILE_MARKER,
  type NativeRoles,
} from "./shared.js";
import type { BlockDialect } from "./shared.js";
import type {
  JsonValue,
  NativeLink,
  NativeSpawn,
  NormalizedMessage,
  SessionDelta,
  SourceRecord,
} from "./types.js";

/** Codex carries tool calls and results as their own response items, never as content blocks. */
const dialect: BlockDialect = {
  textTypes: ["input_text", "output_text", "text"],
  thinkingTypes: ["thinking"],
};
/** Response items that are tool calls and the items that answer them. */
const ORDINARY_CALL_TYPES = new Set([
  "function_call",
  "custom_tool_call",
  "local_shell_call",
]);
const ORDINARY_RESULT_TYPES = new Set([
  "function_call_output",
  "custom_tool_call_output",
]);
const nativeRoles: NativeRoles = {
  user: "USER",
  assistant: "ASSISTANT",
  developer: "SYSTEM",
  system: "SYSTEM",
};
function argumentsValue(value: unknown): JsonValue {
  if (typeof value !== "string") return json(value);
  try {
    return json(JSON.parse(value) as unknown);
  } catch {
    return value;
  }
}
/**
 * Codex 0.153.4 tags every persisted message with `content_item_kinds`; a human prompt
 * is `user.text`, while environment context, plugin lists and AGENTS.md are injected
 * with the user role (verified live, Appendix A).
 */
function contentItemKinds(payload: Record<string, unknown>): string[] | null {
  const kinds = object(
    payload.internal_chat_message_metadata_passthrough,
  ).content_item_kinds;
  return Array.isArray(kinds)
    ? kinds.flatMap((kind) => {
        const value = string(kind);
        return value ? [value] : [];
      })
    : null;
}
/** Older rollouts carry no kinds; these wrappers are the injected user-role context. */
const INJECTED_USER_CONTEXT =
  /^\s*(?:<(?:environment_context|recommended_plugins|user_instructions|permissions instructions|skills_instructions|collaboration_mode|multi_agent_role|multi_agent_mode|turn_aborted|AGENTS\.md)\b|# AGENTS\.md instructions for )/;
/** `FileChange` kinds and `apply_patch` headers (lowercased) to the recorded file operation. */
const CHANGE_OPERATIONS: Readonly<Record<string, string>> = {
  add: "write",
  update: "edit",
  delete: "delete",
};
/** `FileChange` items are Codex's own record of apply_patch results (absolute paths). */
function changedFiles(changes: unknown): { path: string; ops: string[] }[] {
  return Object.entries(object(changes)).flatMap(([path, value]) => {
    const change = object(value);
    const operation = CHANGE_OPERATIONS[string(change.type) ?? ""];
    if (!operation) return [];
    const move = string(change.move_path);
    return [
      { path, ops: [operation] },
      ...(move ? [{ path: move, ops: ["write"] }] : []),
    ];
  });
}
/** Codex parses its own shell commands; `parsed_cmd` read entries name the file read. */
function commandReads(
  item: Record<string, unknown>,
): { path: string; ops: string[] }[] {
  const cwd = string(item.cwd);
  let base: string | null = null;
  if (cwd) {
    try {
      base = cwd.startsWith("file:")
        ? decodeURIComponent(new URL(cwd).pathname)
        : cwd;
    } catch {
      base = null;
    }
  }
  return array(item.parsed_cmd).flatMap((value) => {
    const command = object(value);
    const path = string(command.path);
    if (command.type !== "read" || !path) return [];
    return [{ path: base ? posix.resolve(base, path) : path, ops: ["read"] }];
  });
}
/** The `thread_spawn` source of a `session_meta` payload; empty for a root thread. */
function threadSpawn(native: Record<string, unknown>): Record<string, unknown> {
  return object(object(object(native.source).subagent).thread_spawn);
}
/** `SubAgentActivity` `started` items pair the `spawn_agent` call id with the child thread. */
function subagentStart(record: SourceRecord) {
  const payload = object(record.payload.payload);
  const item = object(payload.item);
  const toolUseId = string(item.id);
  const childNativeRef = string(item.agent_thread_id);
  return record.payload.type === "event_msg" &&
    payload.type === "item_completed" &&
    item.type === "SubAgentActivity" &&
    item.kind === "started" &&
    toolUseId &&
    childNativeRef
    ? { toolUseId, childNativeRef }
    : null;
}
function nativeCompletion(record: SourceRecord) {
  const payload = object(record.payload.payload);
  const item = object(payload.item);
  const id = string(item.id);
  if (
    record.payload.type !== "event_msg" ||
    payload.type !== "item_completed" ||
    !id
  )
    return null;
  if (
    item.type === "McpToolCall" &&
    ["completed", "failed"].includes(string(item.status) ?? "") &&
    typeof item.server === "string" &&
    item.server.length > 0 &&
    typeof item.tool === "string" &&
    item.tool.length > 0
  )
    return {
      id,
      item,
      toolName: `mcp__${item.server}__${item.tool}`,
      input: json(item.arguments),
      result: item.result ?? item.error,
    };
  if (
    item.type === "Extension" &&
    item.kind === "web.search" &&
    object(item.action).type === "search"
  )
    return {
      id,
      item,
      toolName: "web.search",
      input: json(item.action),
      result: item.results,
    };
  if (item.type === "FileChange" && Object.keys(object(item.changes)).length) {
    const output = [string(item.stdout), string(item.stderr)]
      .filter((value): value is string => Boolean(value))
      .join("\n");
    return {
      id,
      item,
      toolName: "apply_patch",
      input: json(item.changes),
      result: output || (string(item.status) ?? ""),
      files: changedFiles(item.changes),
    };
  }
  return null;
}
type NativeCompletion = ReturnType<typeof nativeCompletion>;
function patchFiles(
  toolName: string | null,
  input: JsonValue,
): { path: string; ops: string[] }[] {
  if (
    toolName?.split(".").at(-1) !== "apply_patch" ||
    typeof input !== "string"
  )
    return [];
  return [
    ...input.matchAll(/^\*\*\* (Add|Update|Delete) File: (.+)$/gm),
  ].flatMap((match) => {
    const path = match[2];
    const operation = CHANGE_OPERATIONS[match[1]?.toLowerCase() ?? ""];
    return path && operation ? [{ path, ops: [operation] }] : [];
  });
}
export const codex = createNormalizer({
  harness: "CODEX",
  redactionStructure: protocolObject(["timestamp"], {
    timestamp: protocolTimestamp,
    type: protocolLiterals(
      "session_meta",
      "turn_context",
      "world_state",
      "event_msg",
      "response_item",
    ),
    payload: protocolObject(
      [
        "id",
        "call_id",
        "timestamp",
        "cli_version",
        "entrypoint",
        "originator",
        "cwd",
        "thread_name",
        "agent_role",
        "agent_nickname",
        "base_instructions",
        "model",
        "name",
        "arguments",
        "input",
        "action",
        "output",
        "parent_thread_id",
        "started_at_ms",
        "completed_at_ms",
        "author",
        "recipient",
        "agent_path",
      ],
      {
        timestamp: protocolTimestamp,
        type: protocolLiterals(
          "token_count",
          "message",
          "function_call",
          "custom_tool_call",
          "local_shell_call",
          "function_call_output",
          "custom_tool_call_output",
          "reasoning",
          "item_completed",
          "agent_message",
        ),
        item: protocolObject(
          [
            "id",
            "server",
            "tool",
            "arguments",
            "result",
            "error",
            "duration",
            "readOnlyHint",
            "query",
            "results",
            "agent_thread_id",
            "agent_path",
          ],
          {
            type: protocolLiterals(
              "McpToolCall",
              "Extension",
              "FileChange",
              "CommandExecution",
              "AgentMessage",
              "UserMessage",
              "SubAgentActivity",
              "CollabAgentToolCall",
              "Reasoning",
            ),
            kind: protocolLiterals("web.search", "started", "completed"),
            status: protocolLiterals("completed", "failed"),
            action: protocolObject(["query", "queries"], {
              type: protocolLiterals("search"),
            }),
          },
        ),
        role: protocolLiterals("user", "assistant", "developer", "system"),
        content: protocolArray(
          protocolObject(["text", "thinking"], {
            type: protocolLiterals(
              "input_text",
              "output_text",
              "text",
              "thinking",
              "image",
            ),
          }),
        ),
        summary: protocolArray(
          protocolObject(["text"], { type: protocolLiterals("summary_text") }),
        ),
        info: protocolObject([], {
          total_token_usage: protocolObject(["input_tokens", "output_tokens"]),
        }),
        git: protocolObject(["branch", "repository_url", "commit_hash"]),
        source: protocolObject([], {
          subagent: protocolObject([], {
            thread_spawn: protocolObject(["parent_thread_id"]),
          }),
        }),
        forked_from: protocolObject(["id"]),
      },
    ),
  }),
  nativeIdentities: (record) =>
    identitiesAt(record, [
      ["payload", "id"],
      ["payload", "parent_thread_id"],
      ["payload", "source", "subagent", "thread_spawn", "parent_thread_id"],
      ["payload", "forked_from"],
      ["payload", "forked_from", "id"],
      ...(subagentStart(record)
        ? [["payload", "item", "agent_thread_id"] as const]
        : []),
    ]),
  toolIdentities(record) {
    const completion = nativeCompletion(record);
    if (completion)
      return [{ id: completion.id, path: ["payload", "item", "id"] }];
    const spawn = subagentStart(record);
    if (spawn)
      return [{ id: spawn.toolUseId, path: ["payload", "item", "id"] }];
    const payload = object(record.payload.payload);
    const type = string(payload.type) ?? "";
    if (
      record.payload.type !== "response_item" ||
      (!ORDINARY_CALL_TYPES.has(type) && !ORDINARY_RESULT_TYPES.has(type))
    )
      return [];
    const field = typeof payload.call_id === "string" ? "call_id" : "id";
    const id = string(payload[field]);
    return id ? [{ id, path: ["payload", field] }] : [];
  },
  toolResults(record) {
    const completion = nativeCompletion(record);
    if (completion)
      return [
        {
          toolUseId: completion.id,
          locations: ["result", "error", "results", "stdout", "stderr"].flatMap(
            (field) =>
              completion.item[field] !== undefined &&
              completion.item[field] !== null
                ? [
                    {
                      path: ["payload", "item", field],
                      replacement: SENSITIVE_FILE_MARKER,
                    },
                  ]
                : [],
          ),
        },
      ];
    const payload = object(record.payload.payload);
    if (
      record.payload.type !== "response_item" ||
      !ORDINARY_RESULT_TYPES.has(string(payload.type) ?? "")
    )
      return [];
    return [
      {
        toolUseId: string(payload.call_id),
        locations: [
          {
            path: ["payload"],
            replacement: {
              type: string(payload.type),
              call_id: string(payload.call_id),
              ...(typeof payload.id === "string" ? { id: payload.id } : {}),
              output: SENSITIVE_FILE_MARKER,
            },
          },
        ],
      },
    ];
  },
  toMessages(records) {
    const ordinaryCalls = new Set<string>();
    const ordinaryResults = new Set<string>();
    const completions = new Map<string, NativeCompletion>();
    const firstCompletion = new Map<string, string>();
    const lastResult = new Map<string, string>();
    for (const record of records) {
      const payload = object(record.payload.payload);
      if (record.payload.type === "response_item") {
        const type = string(payload.type) ?? "";
        const target = ORDINARY_CALL_TYPES.has(type)
          ? ordinaryCalls
          : ORDINARY_RESULT_TYPES.has(type)
            ? ordinaryResults
            : null;
        for (const id of [string(payload.call_id), string(payload.id)])
          if (id) target?.add(id);
      }
      const completion = nativeCompletion(record);
      if (!completion) continue;
      completions.set(record.id, completion);
      if (!firstCompletion.has(completion.id))
        firstCompletion.set(completion.id, record.id);
      if (completion.result !== undefined && completion.result !== null)
        lastResult.set(completion.id, record.id);
    }
    let model: string | null = null;
    let cumulativeInput = 0n;
    let cumulativeOutput = 0n;
    let recordedInstructions = false;
    let resumeMayResetUsage = false;
    // The exec call whose output has not arrived yet; Codex writes its CommandExecution
    // items (with parsed reads) between that call and its output record.
    let pendingCall: NormalizedMessage | null = null;
    return records.flatMap((record) => {
      const data = record.payload;
      const type = string(data.type);
      if (type === null) return [];
      const payload = object(data.payload);
      if (type === "event_msg" && payload.type === "item_completed") {
        const item = object(payload.item);
        if (item.type === "CommandExecution") {
          const reads = commandReads(item);
          if (pendingCall && reads.length)
            pendingCall.files = [...(pendingCall.files ?? []), ...reads];
          return [];
        }
      }
      const completion = completions.get(record.id);
      if (completion) {
        const result: NormalizedMessage[] = [];
        const fields = {
          model,
          toolName: completion.toolName,
          toolUseId: completion.id,
          nativeId: completion.id,
        };
        if (
          firstCompletion.get(completion.id) === record.id &&
          !ordinaryCalls.has(completion.id)
        )
          result.push(
            message(record, 0, {
              ...fields,
              role: "ASSISTANT",
              kind: "TOOL_USE",
              toolInput: completion.input,
              ...(completion.files ? { files: completion.files } : {}),
              timestamp:
                timestamp(payload.started_at_ms) ?? timestamp(data.timestamp),
            }),
          );
        if (
          lastResult.get(completion.id) === record.id &&
          !ordinaryResults.has(completion.id)
        )
          result.push(
            message(record, 1, {
              ...fields,
              role: "TOOL_RESULT",
              kind: "TOOL_RESULT",
              content: text(completion.result),
              timestamp:
                timestamp(payload.completed_at_ms) ?? timestamp(data.timestamp),
            }),
          );
        return result;
      }
      if (type === "session_meta") {
        if (recordedInstructions) {
          resumeMayResetUsage = true;
          return [];
        }
        recordedInstructions = true;
        return [
          message(record, 0, {
            content: text(payload.base_instructions),
            nativeId: string(payload.id),
          }),
        ];
      }
      if (type === "turn_context") {
        model = string(payload.model) ?? model;
        return [];
      }
      if (type === "world_state")
        return [message(record, 0, { content: text(payload), model })];
      if (type === "event_msg" && payload.type === "token_count") {
        const total = object(object(payload.info).total_token_usage);
        const input = tokens(total.input_tokens);
        const output = tokens(total.output_tokens);
        const reset =
          resumeMayResetUsage &&
          ((input !== null && input < cumulativeInput) ||
            (output !== null && output < cumulativeOutput));
        if (reset) {
          cumulativeInput = 0n;
          cumulativeOutput = 0n;
        }
        if (input !== null || output !== null) resumeMayResetUsage = false;
        const inputUsage = advanceCumulativeUsage(input, cumulativeInput);
        const outputUsage = advanceCumulativeUsage(output, cumulativeOutput);
        cumulativeInput = inputUsage.total;
        cumulativeOutput = outputUsage.total;
        return [
          message(record, 0, {
            content: "Token usage",
            model,
            inputTokens: inputUsage.delta,
            outputTokens: outputUsage.delta,
          }),
        ];
      }
      if (type !== "response_item") return [];
      const itemType = string(payload.type) ?? "";
      if (itemType === "message") {
        const role = nativeRoles[string(payload.role) ?? ""];
        if (!role) return [];
        const kinds = contentItemKinds(payload);
        const injected =
          role === "USER" &&
          kinds !== null &&
          kinds.length > 0 &&
          !kinds.includes("user.text");
        const result = blocks(record, payload.content, role, dialect, {
          model,
          nativeId: string(payload.id),
        });
        for (const item of result)
          if (
            role === "SYSTEM" ||
            injected ||
            (role === "USER" &&
              !kinds?.length &&
              INJECTED_USER_CONTEXT.test(item.content))
          ) {
            item.role = "SYSTEM";
            item.kind = "META";
          }
        return result;
      }
      // Inter-agent traffic: the subagent's final answer reaches the parent only here.
      if (itemType === "agent_message")
        return blocks(record, payload.content, "SYSTEM", dialect, {
          model,
          nativeId: string(payload.id),
        }).filter((item) => item.kind === "TEXT");
      if (ORDINARY_CALL_TYPES.has(itemType)) {
        const toolName =
          string(payload.name) ??
          (itemType === "local_shell_call" ? "local_shell" : null);
        const toolInput = argumentsValue(
          payload.arguments ?? payload.input ?? payload.action,
        );
        const call = message(record, 0, {
          role: "ASSISTANT",
          kind: "TOOL_USE",
          model,
          toolName,
          toolUseId: string(payload.call_id) ?? string(payload.id),
          toolInput,
          files: patchFiles(toolName, toolInput),
          nativeId: string(payload.id),
        });
        pendingCall = call;
        return [call];
      }
      if (ORDINARY_RESULT_TYPES.has(itemType)) {
        if (pendingCall?.toolUseId === string(payload.call_id))
          pendingCall = null;
        return [
          message(record, 0, {
            role: "TOOL_RESULT",
            kind: "TOOL_RESULT",
            model,
            content: text(payload.output),
            toolUseId: string(payload.call_id),
            nativeId: string(payload.id),
          }),
        ];
      }
      if (itemType === "reasoning") {
        const parts = array(payload.summary).length
          ? payload.summary
          : payload.content;
        const content = text(parts);
        return content
          ? [
              message(record, 0, {
                role: "ASSISTANT",
                kind: "THINKING",
                content,
                model,
                nativeId: string(payload.id),
              }),
            ]
          : [];
      }
      return [];
    });
  },
  sessionDelta(records) {
    const delta: SessionDelta = {};
    for (const { payload: data } of records) {
      if (data.type !== "session_meta") continue;
      const native = object(data.payload);
      const git = object(native.git);
      assignPresent(delta, {
        harnessSessionId: string(native.id),
        harnessVersion: string(native.cli_version),
        entrypoint: string(native.entrypoint) ?? string(native.originator),
        cwd: string(native.cwd),
        branch: string(git.branch),
        repoUrl: string(git.repository_url),
        startCommit: string(git.commit_hash),
        // Subagent threads have no human prompt; Codex names them by agent_path.
        title: string(native.thread_name) ?? string(native.agent_path),
        // A configured role names the agent kind. Without one, the hook-reported
        // agent_type stays in the header; nicknames are random display names.
        agentType:
          string(native.agent_role) ?? string(threadSpawn(native).agent_role),
      });
      const time = timestamp(native.timestamp) ?? timestamp(data.timestamp);
      if (!delta.startedAt && time) delta.startedAt = time;
    }
    return delta;
  },
  links(records) {
    const links: NativeLink[] = [];
    for (const { payload: data } of records) {
      if (data.type !== "session_meta") continue;
      const native = object(data.payload);
      const parent =
        string(threadSpawn(native).parent_thread_id) ??
        string(native.parent_thread_id);
      const fork =
        string(native.forked_from) ?? string(object(native.forked_from).id);
      if (parent) links.push({ relation: "SUBAGENT", parentNativeRef: parent });
      else if (fork) links.push({ relation: "FORK", parentNativeRef: fork });
    }
    return uniqueBy(
      links,
      (link) => `${link.relation}:${link.parentNativeRef}`,
    );
  },
  spawns(records) {
    const spawns: NativeSpawn[] = [];
    for (const record of records) {
      const spawn = subagentStart(record);
      if (spawn) spawns.push(spawn);
    }
    return spawns;
  },
});
