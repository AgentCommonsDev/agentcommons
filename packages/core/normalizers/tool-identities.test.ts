import { describe, expect, it } from "vitest";
import { claudeCode, codex, geminiCli, pi } from "./index.js";
import {
  Redactor,
  maskToolResults,
  redactSourceRecord,
} from "../redaction/index.js";
import { object } from "./shared.js";
import {
  geminiMessages,
  jsonlRecords,
  sourceRecord,
} from "../test/fixtures.js";

const directory = new URL(
  "../../../fixtures/transcripts/tool-identities/",
  import.meta.url,
);
const records = (name: string) => jsonlRecords(new URL(name, directory));
function completions(name = "codex.jsonl") {
  return records(name).filter((record) => {
    const payload = object(record.payload.payload);
    return (
      payload.type === "item_completed" &&
      ["McpToolCall", "Extension"].includes(String(object(payload.item).type))
    );
  });
}
function firstCompletion() {
  const record = completions()[0];
  if (!record) throw new Error("Live MCP completion fixture is missing.");
  return record;
}

describe("live native search tool contracts", () => {
  // @req R-HRN-01 @req R-HRN-03
  it("preserves the separately captured native filename-search tools", () => {
    const document = geminiMessages(new URL("gemini-glob.json", directory));
    expect(
      claudeCode
        .toMessages(records("claude-glob.jsonl"))
        .filter((message) => message.kind === "TOOL_USE")
        .map((message) => message.toolName),
    ).toEqual(["Glob"]);
    expect(
      geminiCli
        .toMessages(document.map((payload, pos) => sourceRecord(payload, pos)))
        .filter((message) => message.kind === "TOOL_USE")
        .map((message) => message.toolName),
    ).toEqual(["glob"]);
  });
  // @req R-HRN-01 @req R-HRN-03 @req R-HRN-04
  it("normalizes exact captured Claude, Gemini and pi names without counting result blocks as calls", () => {
    const document = geminiMessages(new URL("gemini.json", directory));
    const piRecords = records("pi.jsonl");
    const leaf = piRecords.at(-1)?.payload.id;
    expect(typeof leaf).toBe("string");
    const observed = [
      claudeCode.toMessages(records("claude.jsonl")),
      geminiCli.toMessages(
        document.map((payload, pos) => sourceRecord(payload, pos)),
      ),
      pi.toMessages(piRecords, { activeLeafId: String(leaf) }),
    ];
    expect(
      observed.map((messages) =>
        messages
          .filter((message) => message.kind === "TOOL_USE")
          .map((message) => message.toolName),
      ),
    ).toEqual([
      [
        "mcp__agentcommons__search",
        "mcp__agentcommons__search",
        "Grep",
        "WebSearch",
      ],
      [
        "mcp_agentcommons_search",
        "mcp_agentcommons_search",
        "grep_search",
        "google_web_search",
      ],
      ["grep", "find"],
    ]);
    for (const messages of observed) {
      const uses = messages.filter((message) => message.kind === "TOOL_USE");
      const results = messages.filter(
        (message) => message.kind === "TOOL_RESULT",
      );
      expect(results).toHaveLength(uses.length);
      expect(new Set(results.map((message) => message.toolUseId))).toEqual(
        new Set(uses.map((message) => message.toolUseId)),
      );
    }
  });

  // @req R-HRN-02 @req R-ING-05
  it("projects successful typed Codex MCP and web completions in source order, independently of exec source text", () => {
    const input = completions();
    const messages = codex.toMessages([...input].reverse());
    const uses = messages.filter((message) => message.kind === "TOOL_USE");
    expect(uses.map((message) => message.toolName)).toEqual([
      "mcp__agentcommons__search",
      "mcp__agentcommons__search",
      "web.search",
    ]);
    const full = codex.toMessages(records("codex.jsonl"));
    expect(
      full
        .filter(
          (message) =>
            message.kind === "TOOL_USE" &&
            ["mcp__agentcommons__search", "web.search"].includes(
              message.toolName ?? "",
            ),
        )
        .map((message) => message.toolName),
    ).toEqual(uses.map((message) => message.toolName));
    expect(uses.slice(0, 2).map((message) => message.toolInput)).toEqual([
      { query: "contract-first" },
      { query: "contract-second" },
    ]);
    expect(
      messages.filter((message) => message.kind === "TOOL_RESULT"),
    ).toHaveLength(3);
    for (const use of uses) {
      const record = input.find((record) => record.id === use.rawRecordId);
      const payload = object(record?.payload.payload);
      expect(use.timestamp?.getTime()).toBe(payload.started_at_ms);
      expect(
        messages
          .find(
            (message) =>
              message.kind === "TOOL_RESULT" &&
              message.toolUseId === use.toolUseId,
          )
          ?.timestamp?.getTime(),
      ).toBe(payload.completed_at_ms);
    }
    expect(
      codex
        .toMessages([
          sourceRecord(
            {
              type: "response_item",
              payload: {
                type: "custom_tool_call",
                name: "exec",
                call_id: "code-only",
                input:
                  'await tools.mcp__agentcommons__search({query:"unexecuted"})',
              },
            },
            0,
          ),
        ])
        .map((message) => message.toolName),
    ).toEqual(["exec"]);
  });

  // @req R-HRN-02
  it("preserves actual rejected attempts and error results without inventing successful output", () => {
    const messages = codex.toMessages(completions("codex-failed.jsonl"));
    const errors = messages.filter(
      (message) =>
        message.kind === "TOOL_RESULT" &&
        message.toolName === "mcp__agentcommons__search",
    );
    expect(errors).toHaveLength(2);
    for (const error of errors)
      expect(error.content).toContain("requires approval");
  });

  // @req R-HRN-02 @req R-ING-05
  it("counts one invocation across duplicate completions and ordinary call/result observations", () => {
    const original = firstCompletion();
    const id = String(object(object(original.payload.payload).item).id);
    const duplicate = {
      ...original,
      id: "later-observation",
      pos: original.pos + 100n,
    };
    expect(
      codex.toMessages([duplicate, original]).map((message) => message.kind),
    ).toEqual(["TOOL_USE", "TOOL_RESULT"]);
    const call = sourceRecord(
      {
        type: "response_item",
        payload: {
          type: "function_call",
          call_id: id,
          name: "mcp__agentcommons__search",
          arguments: '{"query":"contract-first"}',
        },
      },
      0,
    );
    const result = {
      ...sourceRecord(
        {
          type: "response_item",
          payload: {
            type: "function_call_output",
            call_id: id,
            output: "native direct result",
          },
        },
        1000,
      ),
      id: "direct-result",
    };
    const messages = codex.toMessages([duplicate, result, original, call]);
    expect(messages.map((message) => message.kind)).toEqual([
      "TOOL_USE",
      "TOOL_RESULT",
    ]);
    expect(messages[1]?.content).toBe("native direct result");
  });

  // @req R-HRN-02
  it("keeps unknown extensions, web open/find actions, and unfinished MCP observations raw-only", () => {
    const original = firstCompletion();
    const item = object(object(original.payload.payload).item);
    const variants = [
      {
        ...item,
        type: "Extension",
        kind: "future.search",
        action: { type: "search" },
      },
      {
        ...item,
        type: "Extension",
        kind: "web.search",
        action: { type: "open" },
      },
      {
        ...item,
        type: "Extension",
        kind: "web.search",
        action: { type: "find" },
      },
      { ...item, status: "in_progress" },
    ];
    for (const value of variants)
      expect(
        codex.toMessages([
          sourceRecord(
            {
              type: "event_msg",
              payload: { type: "item_completed", item: value },
            },
            0,
          ),
        ]),
      ).toEqual([]);
    const noResult = { ...item };
    delete noResult.result;
    delete noResult.error;
    expect(
      codex
        .toMessages([
          sourceRecord(
            {
              type: "event_msg",
              payload: { type: "item_completed", item: noResult },
            },
            0,
          ),
        ])
        .map((message) => message.kind),
    ).toEqual(["TOOL_USE"]);
  });

  // @req R-RED-01 @req R-HRN-02
  it("redacts typed completion content and retains identity/result pairing through rescans", async () => {
    const input = completions();
    const item = object(object(firstCompletion().payload.payload).item);
    const redactor = new Redactor([
      {
        id: "native-contract",
        kind: "REGEX",
        name: "native-contract",
        pattern: "contract-first|exec-[a-f0-9-]+",
        flags: "g",
        enabled: true,
        builtin: false,
      },
    ]);
    const masked = maskToolResults(codex, input);
    const once = await Promise.all(
      masked.map(
        async (record) =>
          (await redactSourceRecord(codex, record, redactor)).value,
      ),
    );
    const twice = await Promise.all(
      maskToolResults(codex, once).map(
        async (record) =>
          (await redactSourceRecord(codex, record, redactor)).value,
      ),
    );
    const serialized = JSON.stringify(twice.map((record) => record.payload));
    expect(serialized).not.toContain("contract-first");
    expect(serialized).not.toContain(String(item.id));
    expect(codex.toMessages(twice)).toEqual(codex.toMessages(once));
    expect(
      codex.toMessages(twice).filter((message) => message.kind === "TOOL_USE"),
    ).toHaveLength(3);
    expect(
      codex
        .toMessages(twice)
        .filter((message) => message.kind === "TOOL_RESULT"),
    ).toHaveLength(3);
  });
});
