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
  createNormalizer,
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
import type { NormalizedMessage, SessionDelta } from "./types.js";

const fileRules = {
  read_file: { paths: ["file_path", "path"], ops: ["read"] },
  write_file: { paths: ["file_path", "path"], ops: ["write"] },
  replace: { paths: ["file_path", "path"], ops: ["edit"] },
};
export const geminiCli = createNormalizer({
  harness: "GEMINI_CLI",
  redactionStructure: protocolObject(["id", "timestamp", "model", "content"], {
    timestamp: protocolTimestamp,
    type: protocolLiterals("user", "gemini"),
    thoughts: protocolArray(protocolObject(["text", "subject", "timestamp"])),
    tokens: protocolObject(["input", "output"]),
    toolCalls: protocolArray(
      protocolObject(["id", "name", "args", "timestamp", "resultDisplay"], {
        timestamp: protocolTimestamp,
        status: protocolLiterals(
          "success",
          "error",
          "cancelled",
          "executing",
          "validating",
          "scheduled",
          "awaiting_approval",
        ),
        result: protocolArray(
          protocolObject([], {
            functionResponse: protocolObject(["id", "name"], {
              response: protocolObject(["output", "error"]),
            }),
          }),
        ),
      }),
    ),
  }),
  nativeIdentities: (record) => identitiesAt(record, [["id"]]),
  versioned: true,
  toolIdentities(record) {
    return array(record.payload.toolCalls).flatMap((value, index) => {
      const id = string(object(value).id);
      return id ? [{ id, path: ["toolCalls", index, "id"] }] : [];
    });
  },
  toolResults(record) {
    if (record.payload.type !== "gemini") return [];
    return array(record.payload.toolCalls).flatMap((value, index) => {
      const tool = object(value);
      if (tool.result === undefined && tool.resultDisplay === undefined)
        return [];
      return [
        {
          rawRecordId: record.id,
          toolUseId: string(tool.id),
          locations: [
            {
              path: ["toolCalls", index],
              replacement: {
                id: string(tool.id),
                name: string(tool.name),
                args: json(tool.args),
                ...(typeof tool.timestamp === "string" ||
                typeof tool.timestamp === "number"
                  ? { timestamp: tool.timestamp }
                  : {}),
                result: [
                  {
                    functionResponse: {
                      name: string(tool.name),
                      response: { output: SENSITIVE_FILE_MARKER },
                    },
                  },
                ],
                ...(tool.resultDisplay === undefined
                  ? {}
                  : { resultDisplay: SENSITIVE_FILE_MARKER }),
              },
            },
          ],
        },
      ];
    });
  },
  toMessages(records, context) {
    const length = context?.transcriptMetadata?.sourceRecordCount;
    const current =
      typeof length === "number" && Number.isSafeInteger(length) && length >= 0
        ? records.filter((record) => record.pos < BigInt(length))
        : records;
    return current.flatMap((record) => {
      const data = object(record.payload);
      if (data.type !== "user" && data.type !== "gemini") return [];
      const model = string(data.model);
      const role = data.type === "user" ? "USER" : "ASSISTANT";
      const result: NormalizedMessage[] = [];
      const content = text(data.content);
      if (content)
        result.push(message(record, 0, { role, kind: "TEXT", content, model }));
      let blockIndex = 1;
      for (const thought of array(data.thoughts))
        result.push(
          message(record, blockIndex++, {
            role: "ASSISTANT",
            kind: "THINKING",
            content: text(object(thought).text ?? thought),
            model,
          }),
        );
      for (const value of array(data.toolCalls)) {
        const tool = object(value);
        const toolName = string(tool.name);
        const toolUseId = string(tool.id);
        const toolInput = json(tool.args);
        result.push(
          message(record, blockIndex++, {
            role: "ASSISTANT",
            kind: "TOOL_USE",
            content: "",
            model,
            toolName,
            toolUseId,
            toolInput,
            files: toolFiles(toolName, toolInput, fileRules),
          }),
        );
        if (tool.result !== undefined) {
          const content = array(tool.result)
            .map((entry) => {
              const response = object(object(entry).functionResponse);
              return text(response.response ?? entry);
            })
            .join("\n");
          result.push(
            message(record, blockIndex++, {
              role: "TOOL_RESULT",
              kind: "TOOL_RESULT",
              content,
              model,
              toolName,
              toolUseId,
              timestamp: timestamp(tool.timestamp) ?? timestamp(data.timestamp),
            }),
          );
        }
      }
      const usage = object(data.tokens);
      assignUsage(result, tokens(usage.input), tokens(usage.output));
      return result;
    });
  },
  sessionDelta(_records, context) {
    const delta: SessionDelta = {};
    const metadata = context?.transcriptMetadata ?? {};
    const id = string(metadata.sessionId);
    if (id) delta.harnessSessionId = id;
    const start = timestamp(metadata.startTime);
    if (start) delta.startedAt = start;
    return delta;
  },
  links() {
    return [];
  },
});
