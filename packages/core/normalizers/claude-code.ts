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
  anthropicBlocks,
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
import type {
  NativeLink,
  NativeSpawn,
  NormalizedMessage,
  SessionDelta,
} from "./types.js";

const knownRecordTypes = new Set([
  "user",
  "assistant",
  "system",
  "attachment",
  "summary",
  "ai-title",
  "last-prompt",
  "queue-operation",
  "atis-latch",
]);
/** Claude Code stamps locally generated assistant rows (API errors, interruptions) with this model. */
const SYNTHETIC_MODEL = "<synthetic>";
/** A subagent transcript's native session id: the layout the shim registers at `SubagentStart`. */
function subagentSessionId(sessionId: string, agentId: string): string {
  return `${sessionId}:agent-${agentId}`;
}
/** `gitBranch` is `git rev-parse --abbrev-ref HEAD`, which prints `HEAD` when detached. */
function branchName(value: unknown): string | null {
  const branch = string(value);
  return branch === "HEAD" ? null : branch;
}
const fileRules = {
  Read: { paths: ["file_path"], ops: ["read"] },
  Edit: { paths: ["file_path"], ops: ["edit"] },
  Write: { paths: ["file_path"], ops: ["write"] },
  MultiEdit: { paths: ["file_path"], ops: ["edit"] },
  NotebookEdit: { paths: ["notebook_path"], ops: ["edit"] },
};
export const claudeCode = createNormalizer({
  harness: "CLAUDE_CODE",
  redactionStructure: protocolObject(
    [
      "uuid",
      "parentUuid",
      "sessionId",
      "agentId",
      "isSidechain",
      "timestamp",
      "version",
      "entrypoint",
      "cwd",
      "gitBranch",
      "aiTitle",
      "agentType",
      "summary",
      "content",
      "attachment",
      "toolUseResult",
    ],
    {
      timestamp: protocolTimestamp,
      type: protocolLiterals(...knownRecordTypes),
      message: protocolObject(["id", "model"], {
        role: protocolLiterals("user", "assistant", "system"),
        usage: protocolObject([
          "input_tokens",
          "output_tokens",
          "cache_read_input_tokens",
          "cache_creation_input_tokens",
        ]),
        content: protocolArray(
          protocolObject(
            [
              "text",
              "thinking",
              "id",
              "name",
              "input",
              "tool_use_id",
              "toolName",
              "content",
              "source",
            ],
            {
              type: protocolLiterals(
                "text",
                "thinking",
                "tool_use",
                "tool_result",
                "image",
              ),
            },
          ),
        ),
      }),
    },
  ),
  nativeIdentities: (record) =>
    identitiesAt(record, [
      ["uuid"],
      ["parentUuid"],
      ["sessionId"],
      ["agentId"],
      ["message", "id"],
    ]),
  toolIdentities(record) {
    return array(object(record.payload.message).content).flatMap(
      (value, index) => {
        const block = object(value);
        const field =
          block.type === "tool_use"
            ? "id"
            : block.type === "tool_result"
              ? "tool_use_id"
              : null;
        const id = field ? string(block[field]) : null;
        return id && field
          ? [{ id, path: ["message", "content", index, field] }]
          : [];
      },
    );
  },
  toolResults(record) {
    if (record.payload.type !== "user") return [];
    return array(object(record.payload.message).content).flatMap(
      (value, index) => {
        const block = object(value);
        if (block.type !== "tool_result") return [];
        const id = string(block.tool_use_id);
        return [
          {
            rawRecordId: record.id,
            toolUseId: id,
            locations: [
              {
                path: ["message", "content", index],
                replacement: {
                  type: "tool_result",
                  tool_use_id: id,
                  content: SENSITIVE_FILE_MARKER,
                },
              },
              ...(record.payload.toolUseResult === undefined
                ? []
                : [
                    {
                      path: ["toolUseResult"],
                      replacement: SENSITIVE_FILE_MARKER,
                    },
                  ]),
            ],
          },
        ];
      },
    );
  },
  toMessages(records) {
    const seenUsage = new Map<string, { input: bigint; output: bigint }>();
    return records.flatMap((record) => {
      const parsed = recordSchema.safeParse(record.payload);
      if (!parsed.success) return [];
      const data = parsed.data;
      if (data.type === "summary")
        return [
          message(record, 0, { kind: "TEXT", content: text(data.summary) }),
        ];
      if (data.type === "system" || data.type === "attachment")
        return [
          message(record, 0, {
            content: text(data.content ?? data.attachment ?? data),
          }),
        ];
      if (data.type !== "user" && data.type !== "assistant") return [];
      const native = object(data.message);
      const result: NormalizedMessage[] = blocks(
        record,
        native.content,
        data.type === "user" ? "USER" : "ASSISTANT",
        anthropicBlocks,
        {
          model:
            string(native.model) === SYNTHETIC_MODEL
              ? null
              : string(native.model),
          nativeId: string(data.uuid),
          parentId: string(data.parentUuid),
        },
      );
      for (const item of result)
        if (item.kind === "TOOL_USE")
          item.files = toolFiles(item.toolName, item.toolInput, fileRules);
      const usage = object(native.usage);
      let input = tokens(usage.input_tokens);
      if (input !== null)
        input +=
          (tokens(usage.cache_read_input_tokens) ?? 0n) +
          (tokens(usage.cache_creation_input_tokens) ?? 0n);
      const output = tokens(usage.output_tokens);
      const identity = string(native.id) ?? record.id;
      const previous = seenUsage.get(identity);
      const inputUsage = advanceCumulativeUsage(input, previous?.input ?? 0n);
      const outputUsage = advanceCumulativeUsage(
        output,
        previous?.output ?? 0n,
      );
      assignUsage(result, inputUsage.delta, outputUsage.delta);
      if (result.length > 0)
        seenUsage.set(identity, {
          input: inputUsage.total,
          output: outputUsage.total,
        });
      return result;
    });
  },
  sessionDelta(records) {
    const delta: SessionDelta = {};
    for (const { payload: data } of records) {
      if (!knownRecordTypes.has(string(data.type) ?? "")) continue;
      const values = {
        harnessSessionId: string(data.sessionId),
        harnessVersion: string(data.version),
        entrypoint: string(data.entrypoint),
        cwd: string(data.cwd),
        branch: branchName(data.gitBranch),
        title: string(data.aiTitle),
        agentType: string(data.agentType),
      };
      for (const [key, value] of Object.entries(values))
        if (value) Object.assign(delta, { [key]: value });
      const parent = string(data.sessionId);
      const agent = string(data.agentId);
      if (parent && agent && data.isSidechain === true) {
        delta.harnessSessionId = subagentSessionId(parent, agent);
      }
      // Attachments can be appended before the prompt that precedes them in time.
      const start = timestamp(data.timestamp);
      if (start && (!delta.startedAt || start < delta.startedAt))
        delta.startedAt = start;
    }
    return delta;
  },
  links(records) {
    const links: NativeLink[] = [];
    for (const { payload: data } of records) {
      if (!knownRecordTypes.has(string(data.type) ?? "")) continue;
      const parent = string(data.sessionId);
      if (parent && string(data.agentId) && data.isSidechain === true) {
        links.push({ relation: "SUBAGENT", parentNativeRef: parent });
        break;
      }
    }
    return links;
  },
  // The `Agent` result record names the finished child (`toolUseResult.agentId`) next to
  // the `tool_result` block that carries the spawning `tool_use_id` (Appendix A).
  spawns(records) {
    const spawns: NativeSpawn[] = [];
    for (const { payload: data } of records) {
      if (data.type !== "user") continue;
      const parent = string(data.sessionId);
      const agent = string(object(data.toolUseResult).agentId);
      if (!parent || !agent) continue;
      for (const value of array(object(data.message).content)) {
        const block = object(value);
        const toolUseId =
          block.type === "tool_result" ? string(block.tool_use_id) : null;
        if (toolUseId)
          spawns.push({
            toolUseId,
            childNativeRef: subagentSessionId(parent, agent),
          });
      }
    }
    return spawns;
  },
});
