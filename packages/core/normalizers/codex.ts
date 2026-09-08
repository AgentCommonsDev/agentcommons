import {
  protocolArray,
  protocolLiterals,
  protocolObject,
  protocolTimestamp,
} from "../redaction/structure.js";
import {
  advanceCumulativeUsage,
  array,
  identitiesAt,
  blocks,
  createNormalizer,
  json,
  message,
  object,
  recordSchema,
  string,
  text,
  timestamp,
  tokens,
  SENSITIVE_FILE_MARKER,
} from "./shared.js";
import type { BlockDialect } from "./shared.js";
import type {
  JsonValue,
  NativeLink,
  NormalizedMessage,
  SessionDelta,
  SourceRecord,
} from "./types.js";

const dialect: BlockDialect = {
  textTypes: ["input_text", "output_text", "text"],
  thinkingTypes: ["thinking"],
  toolUseTypes: [],
  toolResultTypes: [],
  toolInput: "arguments",
  toolResultId: "call_id",
};
function argumentsValue(value: unknown): JsonValue {
  if (typeof value !== "string") return json(value);
  try {
    return json(JSON.parse(value) as unknown);
  } catch {
    return value;
  }
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
      payload,
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
      payload,
      item,
      toolName: "web.search",
      input: json(item.action),
      result: item.results,
    };
  return null;
}
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
    return path
      ? [
          {
            path,
            ops: [
              match[1] === "Add"
                ? "write"
                : match[1] === "Delete"
                  ? "delete"
                  : "edit",
            ],
          },
        ]
      : [];
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
          ],
          {
            type: protocolLiterals("McpToolCall", "Extension"),
            kind: protocolLiterals("web.search"),
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
    ]),
  toolIdentities(record) {
    const completion = nativeCompletion(record);
    if (completion)
      return [{ id: completion.id, path: ["payload", "item", "id"] }];
    const payload = object(record.payload.payload);
    if (
      record.payload.type !== "response_item" ||
      ![
        "function_call",
        "custom_tool_call",
        "local_shell_call",
        "function_call_output",
        "custom_tool_call_output",
      ].includes(string(payload.type) ?? "")
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
          rawRecordId: record.id,
          toolUseId: completion.id,
          locations: ["result", "error", "results"].flatMap((field) =>
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
      !["function_call_output", "custom_tool_call_output"].includes(
        string(payload.type) ?? "",
      )
    )
      return [];
    return [
      {
        rawRecordId: record.id,
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
    const firstCompletion = new Map<string, string>();
    const lastResult = new Map<string, string>();
    for (const record of records) {
      const payload = object(record.payload.payload);
      if (record.payload.type === "response_item") {
        const target = [
          "function_call",
          "custom_tool_call",
          "local_shell_call",
        ].includes(string(payload.type) ?? "")
          ? ordinaryCalls
          : ["function_call_output", "custom_tool_call_output"].includes(
                string(payload.type) ?? "",
              )
            ? ordinaryResults
            : null;
        for (const id of [string(payload.call_id), string(payload.id)])
          if (id) target?.add(id);
      }
      const completion = nativeCompletion(record);
      if (!completion) continue;
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
    return records.flatMap((record) => {
      const parsed = recordSchema.safeParse(record.payload);
      if (!parsed.success) return [];
      const data = parsed.data;
      const payload = object(data.payload);
      const completion = nativeCompletion(record);
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
      if (data.type === "session_meta") {
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
      if (data.type === "turn_context") {
        model = string(payload.model) ?? model;
        return [];
      }
      if (data.type === "world_state")
        return [message(record, 0, { content: text(payload), model })];
      if (data.type === "event_msg" && payload.type === "token_count") {
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
      if (data.type !== "response_item") return [];
      const type = string(payload.type);
      if (type === "message") {
        const nativeRole = string(payload.role);
        if (
          !["user", "assistant", "developer", "system"].includes(
            nativeRole ?? "",
          )
        )
          return [];
        const role =
          nativeRole === "user"
            ? "USER"
            : nativeRole === "assistant"
              ? "ASSISTANT"
              : "SYSTEM";
        const result = blocks(record, payload.content, role, dialect, {
          model,
          nativeId: string(payload.id),
        });
        for (const item of result) if (role === "SYSTEM") item.kind = "META";
        return result;
      }
      if (
        type === "function_call" ||
        type === "custom_tool_call" ||
        type === "local_shell_call"
      ) {
        const toolName =
          string(payload.name) ??
          (type === "local_shell_call" ? "local_shell" : null);
        const toolInput = argumentsValue(
          payload.arguments ?? payload.input ?? payload.action,
        );
        return [
          message(record, 0, {
            role: "ASSISTANT",
            kind: "TOOL_USE",
            model,
            toolName,
            toolUseId: string(payload.call_id) ?? string(payload.id),
            toolInput,
            files: patchFiles(toolName, toolInput),
            nativeId: string(payload.id),
          }),
        ];
      }
      if (type === "function_call_output" || type === "custom_tool_call_output")
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
      if (type === "reasoning") {
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
    let metadataCount = 0;
    for (const { payload: data } of records) {
      if (data.type !== "session_meta") continue;
      metadataCount++;
      const native = object(data.payload);
      const git = object(native.git);
      const values = {
        harnessSessionId: string(native.id),
        harnessVersion: string(native.cli_version),
        entrypoint: string(native.entrypoint) ?? string(native.originator),
        cwd: string(native.cwd),
        branch: string(git.branch),
        repoUrl: string(git.repository_url),
        startCommit: string(git.commit_hash),
        title: string(native.thread_name),
        agentType: string(native.agent_role) ?? string(native.agent_nickname),
      };
      for (const [key, value] of Object.entries(values))
        if (value) Object.assign(delta, { [key]: value });
      const time = timestamp(native.timestamp) ?? timestamp(data.timestamp);
      if (!delta.startedAt && time) delta.startedAt = time;
    }
    delta.resumeCount = Math.max(0, metadataCount - 1);
    return delta;
  },
  links(records) {
    const links: NativeLink[] = [];
    for (const { payload: data } of records) {
      if (data.type !== "session_meta") continue;
      const native = object(data.payload);
      const spawn = object(object(object(native.source).subagent).thread_spawn);
      const parent =
        string(spawn.parent_thread_id) ?? string(native.parent_thread_id);
      const fork =
        string(native.forked_from) ?? string(object(native.forked_from).id);
      if (parent) links.push({ relation: "SUBAGENT", parentNativeRef: parent });
      else if (fork) links.push({ relation: "FORK", parentNativeRef: fork });
    }
    return links.filter(
      (link, index) =>
        links.findIndex(
          (other) =>
            other.relation === link.relation &&
            other.parentNativeRef === link.parentNativeRef,
        ) === index,
    );
  },
});
