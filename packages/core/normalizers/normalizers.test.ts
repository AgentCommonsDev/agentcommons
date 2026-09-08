import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { projectionIdentity } from "../redaction/tool-results.js";
import { claudeCode, codex, geminiCli, NORMALIZERS, pi } from "./index.js";
import type { NormalizedMessage, SourceRecord } from "./types.js";

const fixtures = new URL("../../../fixtures/transcripts/", import.meta.url);
const payloadSchema = z.looseObject({});
const receivedAt = new Date("2026-09-07T23:00:00Z");

// @req R-ING-05
it("orders reused positions by durable native identity before blocks, independently of arrival and identity redaction", () => {
  const records = ["native-before", "native-after"].map((key, index) => ({
    ...source(
      {
        type: "user",
        message: {
          content: [
            { type: "text", text: `${key}:first` },
            { type: "text", text: `${key}:second` },
          ],
        },
      },
      0n,
    ),
    id: `raw-${String(index)}`,
    key,
  }));
  const expected = claudeCode.toMessages(records).map((row) => row.content);
  expect(
    claudeCode.toMessages([...records].reverse()).map((row) => row.content),
  ).toEqual(expected);
  expect(
    claudeCode
      .toMessages(
        records.map((row) => ({
          ...row,
          key: projectionIdentity(row.key),
        })),
      )
      .map((row) => row.content),
  ).toEqual(expected);
  for (let index = 0; index < expected.length; index += 2)
    expect(expected[index + 1]).toBe(
      expected[index]?.replace(":first", ":second"),
    );
});
function source(
  payload: Record<string, unknown>,
  pos: bigint,
  sourceVersion = 0,
): SourceRecord {
  return {
    id: `raw-${String(pos)}-${String(sourceVersion)}`,
    pos,
    sourceVersion,
    key: typeof payload.id === "string" ? payload.id : null,
    payload,
    receivedAt,
  };
}
function jsonl(path: string): SourceRecord[] {
  let offset = 0n;
  return readFileSync(new URL(path, fixtures), "utf8")
    .trimEnd()
    .split("\n")
    .map((line) => {
      const record = source(
        payloadSchema.parse(JSON.parse(line) as unknown),
        offset,
      );
      offset += BigInt(Buffer.byteLength(line) + 1);
      return record;
    });
}
function geminiSnapshot(name: string, version: number): SourceRecord[] {
  const document = z
    .looseObject({ messages: z.array(payloadSchema) })
    .parse(
      JSON.parse(
        readFileSync(new URL(`gemini-cli/${name}.json`, fixtures), "utf8"),
      ) as unknown,
    );
  return document.messages.map((payload, index) =>
    source(payload, BigInt(index), version),
  );
}
function snapshot(messages: NormalizedMessage[]): unknown {
  return messages.map((item) => ({
    ...item,
    content: item.kind === "META" ? "[metadata preserved]" : item.content,
    timestamp: item.timestamp?.toISOString() ?? null,
    inputTokens: item.inputTokens?.toString() ?? null,
    outputTokens: item.outputTokens?.toString() ?? null,
  }));
}

describe("Claude Code normalization", () => {
  it("normalizes the live parent/child transcripts and pairs user-role results @req R-HRN-01", () => {
    const records = jsonl("claude-code/parent.jsonl");
    const messages = claudeCode.toMessages(records);
    expect(snapshot(messages)).toMatchSnapshot();
    expect(
      messages
        .filter((item) => item.kind === "TOOL_RESULT")
        .map((item) => item.toolName),
    ).toEqual(["Read", "Agent"]);
    expect(
      messages.find(
        (item) => item.toolName === "Read" && item.kind === "TOOL_USE",
      )?.files,
    ).toEqual([
      {
        path: "/tmp/agentcommons-live-capture/claude/repo/probe.txt",
        ops: ["read"],
      },
    ]);
    expect(claudeCode.links(jsonl("claude-code/subagent.jsonl"))).toEqual([
      {
        relation: "SUBAGENT",
        parentNativeRef: "93db0511-4472-4f3b-90be-899be97a89d1",
      },
    ]);
    expect(
      claudeCode.sessionDelta(jsonl("claude-code/subagent.jsonl"))
        .harnessSessionId,
    ).toBe("93db0511-4472-4f3b-90be-899be97a89d1:agent-ab38e423152bb70b9");
    expect(claudeCode.sessionDelta(records)).toMatchObject({
      harnessVersion: "2.1.263",
      harnessSessionId: "93db0511-4472-4f3b-90be-899be97a89d1",
    });
    // The live file repeats usage for each streamed block sharing message.id.
    expect(
      messages.reduce((sum, item) => sum + (item.outputTokens ?? 0n), 0n),
    ).toBe(469n);
  });

  it("keeps compaction summary text and title metadata without inventing unknown messages @req R-ING-12", () => {
    const unknown = { type: "future_record", newField: { retained: true } };
    const records = [
      source({ type: "summary", summary: "Earlier work" }, 0n),
      source({ type: "ai-title", aiTitle: "Captured title" }, 1n),
      source(unknown, 2n),
    ];
    expect(claudeCode.toMessages(records)).toMatchObject([
      { role: "SYSTEM", kind: "TEXT", content: "Earlier work" },
    ]);
    expect(claudeCode.sessionDelta(records).title).toBe("Captured title");
    expect(records[2]?.payload).toEqual(unknown);
  });
});

describe("Codex normalization", () => {
  it("normalizes observed response variants and keeps developer boilerplate metadata @req R-HRN-02", () => {
    const records = jsonl("codex/tool.jsonl");
    const messages = codex.toMessages(records);
    expect(snapshot(messages)).toMatchSnapshot();
    const call = messages.find((item) => item.kind === "TOOL_USE");
    const result = messages.find((item) => item.kind === "TOOL_RESULT");
    expect(call?.toolName).toBe("exec");
    expect(result?.toolName).toBe("exec");
    expect(result?.toolUseId).toBe(call?.toolUseId);
    expect(result?.content).toContain(
      "AgentCommons Codex live contract probe 2026-09-07.",
    );
    expect(
      messages
        .filter((item) => item.role === "SYSTEM")
        .every((item) => item.kind === "META"),
    ).toBe(true);
    expect(codex.links(jsonl("codex/subagent.jsonl"))).toEqual([
      {
        relation: "SUBAGENT",
        parentNativeRef: "01a07df5-0e59-77c1-8d3d-d649da83637e",
      },
    ]);
  });

  it("derives usage from ordered cumulative events once and leaves missing usage null @req R-ING-14", () => {
    const messages = codex.toMessages(jsonl("codex/tool.jsonl").reverse());
    expect(
      messages.reduce((sum, item) => sum + (item.inputTokens ?? 0n), 0n),
    ).toBe(28298n);
    expect(
      messages.reduce((sum, item) => sum + (item.outputTokens ?? 0n), 0n),
    ).toBe(73n);
    expect(
      messages
        .filter((item) => item.kind === "TOOL_USE")
        .every(
          (item) => item.inputTokens === null && item.outputTokens === null,
        ),
    ).toBe(true);
    const unknownUsage = codex.toMessages([
      source(
        { type: "event_msg", payload: { type: "token_count", info: null } },
        0n,
      ),
    ]);
    expect(unknownUsage[0]?.inputTokens).toBeNull();
    expect(unknownUsage[0]?.outputTokens).toBeNull();
  });

  it("records file changes only from explicit apply_patch, and stores resumed instructions once", () => {
    const records = [
      source(
        {
          type: "session_meta",
          payload: { id: "native", base_instructions: "Instructions" },
        },
        0n,
      ),
      source(
        {
          type: "response_item",
          payload: {
            type: "custom_tool_call",
            name: "apply_patch",
            call_id: "patch",
            input:
              "*** Begin Patch\n*** Add File: src/new.ts\n+hello\n*** Update File: src/old.ts\n*** Delete File: src/gone.ts\n*** End Patch",
          },
        },
        1n,
      ),
      source(
        {
          type: "session_meta",
          payload: { id: "native", base_instructions: "Instructions" },
        },
        2n,
      ),
    ];
    expect(
      codex.toMessages(records).filter((item) => item.kind === "META"),
    ).toHaveLength(1);
    expect(
      codex.toMessages(records).find((item) => item.kind === "TOOL_USE")?.files,
    ).toEqual([
      { path: "src/new.ts", ops: ["write"] },
      { path: "src/old.ts", ops: ["edit"] },
      { path: "src/gone.ts", ops: ["delete"] },
    ]);
    expect(codex.sessionDelta(records).resumeCount).toBe(1);
  });
});

describe("Gemini CLI normalization", () => {
  it("projects the latest captured version without losing late tool results or duplicating text @req R-HRN-04", () => {
    const older = geminiSnapshot("02-before-tools", 0);
    const final = geminiSnapshot("05-final", 1);
    const records = [...final, ...older];
    const messages = geminiCli.toMessages(records);
    expect(snapshot(messages)).toMatchSnapshot();
    expect(
      messages
        .filter((item) => item.kind === "TOOL_USE")
        .map((item) => item.toolName),
    ).toEqual(["read_file", "run_shell_command"]);
    expect(messages.filter((item) => item.kind === "TOOL_RESULT")).toHaveLength(
      2,
    );
    expect(messages.filter((item) => item.kind === "TEXT")).toHaveLength(3);
    expect(messages.every((item) => item.rawRecordId.endsWith("-1"))).toBe(
      true,
    );
    expect(
      messages.reduce((sum, item) => sum + (item.inputTokens ?? 0n), 0n),
    ).toBe(17039n);
    expect(
      messages.find(
        (item) =>
          item.toolName === "run_shell_command" && item.kind === "TOOL_USE",
      )?.files,
    ).toEqual([]);
  });
});

describe("pi normalization", () => {
  it("follows the active branch and links the explicit fork file to its native session @req R-HRN-06", () => {
    const records = jsonl("pi/tree-and-resume.jsonl");
    const current = pi.toMessages(records);
    expect(snapshot(current)).toMatchSnapshot();
    expect(
      current.some((item) => item.content === "second branch point."),
    ).toBe(false);
    expect(current.some((item) => item.content === "alternate branch.")).toBe(
      true,
    );
    const oldBranch = pi.toMessages(records, { activeLeafId: "a2bc6577" });
    expect(
      oldBranch.some((item) => item.content === "second branch point."),
    ).toBe(true);
    expect(oldBranch.some((item) => item.content === "alternate branch.")).toBe(
      false,
    );
    expect(pi.toMessages(records, { activeLeafId: null })).toEqual([]);
    expect(pi.links(jsonl("pi/fork.jsonl"))).toEqual([
      {
        relation: "FORK",
        parentNativeRef: "01a07ded-e222-7379-90d5-02afba4902df",
      },
    ]);
    expect(
      current
        .filter((item) => item.nativeId)
        .every(
          (item) =>
            item.parentId !== null || item.rawRecordId.startsWith("raw-"),
        ),
    ).toBe(true);
  });

  it("handles documented compaction, custom messages, labels and session names as explicit edge inputs", () => {
    const records = [
      source({ type: "session", id: "native" }, 0n),
      source(
        {
          type: "compaction",
          id: "a",
          parentId: null,
          summary: "compacted work",
        },
        1n,
      ),
      source(
        {
          type: "branch_summary",
          id: "b",
          parentId: "a",
          summary: "abandoned work",
        },
        2n,
      ),
      source(
        {
          type: "custom_message",
          id: "c",
          parentId: "b",
          content: "extension content",
        },
        3n,
      ),
      source(
        { type: "custom", id: "d", parentId: "c", data: { opaque: true } },
        4n,
      ),
      source(
        { type: "label", id: "e", parentId: "d", label: "checkpoint" },
        5n,
      ),
      source(
        { type: "session_info", id: "f", parentId: "e", name: "named session" },
        6n,
      ),
    ];
    expect(pi.toMessages(records).map((item) => item.kind)).toEqual([
      "TEXT",
      "TEXT",
      "TEXT",
      "META",
      "META",
      "META",
    ]);
    expect(pi.sessionDelta(records).title).toBe("named session");
  });
});

it("retains missing/invalid source timestamps as null without deriving identity from receipt time @req R-ING-13", () => {
  const records = [
    source(
      {
        type: "user",
        uuid: "first",
        timestamp: "invalid",
        message: { content: "one" },
      },
      0n,
    ),
    source({ type: "user", uuid: "second", message: { content: "two" } }, 1n),
  ];
  const messages = claudeCode.toMessages(records);
  expect(messages.map((item) => item.timestamp)).toEqual([null, null]);
  expect(messages.map((item) => item.rawRecordId)).toEqual([
    "raw-0-0",
    "raw-1-0",
  ]);
  expect(records.every((record) => record.receivedAt === receivedAt)).toBe(
    true,
  );
});

it("has one explicit adapter per supported harness and leaves unknown records raw-only", () => {
  expect(Object.keys(NORMALIZERS)).toEqual([
    "CLAUDE_CODE",
    "CODEX",
    "GEMINI_CLI",
    "PI",
  ]);
  for (const normalizer of Object.values(NORMALIZERS))
    expect(
      normalizer.toMessages([
        source({ type: "future_record", id: "future" }, 0n),
      ]),
    ).toEqual([]);
});

it("bounds multibyte first prompts by bytes without splitting a Unicode character", () => {
  const delta = claudeCode.sessionDelta([
    source({ type: "user", message: { content: "🙂".repeat(2000) } }, 0n),
  ]);
  expect(Buffer.byteLength(delta.firstPrompt ?? "")).toBe(4096);
  expect(delta.firstPrompt).toBe("🙂".repeat(1024));
});
