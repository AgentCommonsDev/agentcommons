import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { projectionIdentity } from "../redaction/tool-results.js";
import { claudeCode, codex, geminiCli, NORMALIZERS, pi } from "./index.js";
import { projectTrace } from "./projection.js";
import { searchableMessage } from "../metadata/index.js";
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
    // The parent's `Agent` result names the finished child next to the spawning call
    // (parent.jsonl line 20: `toolUseResult.agentId` beside the `tool_result` block).
    expect(claudeCode.spawns(records)).toEqual([
      {
        toolUseId: "toolu_018ydYKiWpoWYg2gEdqffW48",
        childNativeRef:
          "93db0511-4472-4f3b-90be-899be97a89d1:agent-ab38e423152bb70b9",
      },
    ]);
    expect(
      messages.find(
        (item) => item.toolName === "Agent" && item.kind === "TOOL_USE",
      )?.toolUseId,
    ).toBe("toolu_018ydYKiWpoWYg2gEdqffW48");
    expect(claudeCode.spawns(jsonl("claude-code/subagent.jsonl"))).toEqual([]);
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

  // Captured live 2026-09-08: Claude Code writes API errors as assistant rows with
  // model "<synthetic>", and stamps gitBranch "HEAD" in a detached repository.
  it("keeps API-error rows as assistant text without a model and treats a detached HEAD as no branch @req R-HRN-01 @req R-GET-03", () => {
    const records = jsonl("claude-code/synthetic-error.jsonl");
    const messages = claudeCode.toMessages(records);
    expect(messages.at(-1)).toMatchObject({
      role: "ASSISTANT",
      kind: "TEXT",
      model: null,
    });
    expect(messages.at(-1)?.content).toContain("API Error");
    expect(messages.map((item) => item.model)).toEqual([
      null,
      "claude-fable-5-1",
      null,
    ]);
    const delta = claudeCode.sessionDelta(records);
    expect(delta.modelsUsed).toEqual(["claude-fable-5-1"]);
    expect(delta.model).toBe("claude-fable-5-1");
    expect(delta.branch).toBe("main");
    // The detached-HEAD records contribute no branch, so only "main" is observed.
    expect(delta.branchesObserved).toEqual(["main"]);
    // parent.jsonl was captured with a detached HEAD; the shim's git context wins.
    const parentDelta = claudeCode.sessionDelta(
      jsonl("claude-code/parent.jsonl"),
    );
    expect(parentDelta.branch).toBeUndefined();
    expect(parentDelta.branchesObserved).toBeUndefined();
  });

  it("collects every distinct branch a session switches through, newest last @req R-SRCH-19", () => {
    const records = ["main", "main", "feature/x", "main"].map((branch, index) =>
      source(
        {
          type: "user",
          sessionId: "s1",
          gitBranch: branch,
          message: {
            content: [{ type: "text", text: `msg ${String(index)}` }],
          },
        },
        BigInt(index),
      ),
    );
    const delta = claudeCode.sessionDelta(records);
    // First-seen order, deduplicated; `branch` is the last one observed and is in the set.
    expect(delta.branchesObserved).toEqual(["main", "feature/x"]);
    expect(delta.branch).toBe("main");
    expect(delta.branchesObserved).toContain(delta.branch);
  });

  // Captured live 2026-09-08: subagent transcripts append attachments stamped later
  // than the prompt record that follows them.
  it("starts the session at the earliest source timestamp, not the first record's @req R-HRN-01 @req R-ING-13", () => {
    const records = [
      source(
        {
          type: "attachment",
          attachment: { type: "date", date: "2026-09-08" },
          timestamp: "2026-09-08T19:10:57.468Z",
        },
        0n,
      ),
      source(
        {
          type: "user",
          message: { role: "user", content: "prompt" },
          timestamp: "2026-09-08T19:10:57.286Z",
        },
        1n,
      ),
    ];
    expect(claudeCode.sessionDelta(records).startedAt?.toISOString()).toBe(
      "2026-09-08T19:10:57.286Z",
    );
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
    // The parent's `SubAgentActivity` `started` item (parent-with-subagent.jsonl line 20)
    // carries the `spawn_agent` call id and the child thread id the child's
    // `session_meta.id` repeats (subagent.jsonl line 1).
    const parent = jsonl("codex/parent-with-subagent.jsonl");
    expect(codex.spawns(parent)).toEqual([
      {
        toolUseId: "call_3waswfBVF9bVkIXj3EqoZSiY",
        childNativeRef: "01a07df5-3d12-7ea1-9f0d-a8f906f862b3",
      },
    ]);
    expect(
      codex.sessionDelta(jsonl("codex/subagent.jsonl")).harnessSessionId,
    ).toBe("01a07df5-3d12-7ea1-9f0d-a8f906f862b3");
    expect(
      codex
        .toMessages(parent)
        .find(
          (item) => item.toolName === "spawn_agent" && item.kind === "TOOL_USE",
        )?.toolUseId,
    ).toBe("call_3waswfBVF9bVkIXj3EqoZSiY");
    expect(codex.spawns(jsonl("codex/subagent.jsonl"))).toEqual([]);
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
  });

  // Live 0.153.4 rollouts: the human prompt is tagged user.text; plugin lists and
  // environment context arrive with the user role and must not become the title.
  it("classifies injected user-role context as META and titles the session by the human prompt @req R-HRN-02", () => {
    const records = jsonl("codex/edit-with-subagent.jsonl");
    const messages = codex.toMessages(records);
    const prompts = messages.filter((item) => item.role === "USER");
    expect(prompts).toHaveLength(1);
    expect(
      prompts[0]?.content.startsWith(
        "acprobe4484bebed1cfd409codex. Do these steps in order.",
      ),
    ).toBe(true);
    expect(
      messages.filter(
        (item) =>
          item.kind === "META" &&
          /^<(?:recommended_plugins|environment_context)>/.test(item.content),
      ),
    ).toHaveLength(2);
    const delta = codex.sessionDelta(records);
    expect(
      delta.title?.startsWith(
        "acprobe4484bebed1cfd409codex. Do these steps in order.",
      ),
    ).toBe(true);
    expect(delta.title).toHaveLength(120);
    expect(delta.firstPrompt?.startsWith("acprobe4484bebed1cfd409codex.")).toBe(
      true,
    );
    const user = (text: string, pos: bigint) =>
      source(
        {
          type: "response_item",
          payload: {
            type: "message",
            id: `msg-${String(pos)}`,
            role: "user",
            content: [{ type: "input_text", text }],
          },
        },
        pos,
      );
    // Rollouts without content kinds are classified by the injected wrapper tags.
    expect(
      codex
        .toMessages([
          user(
            "<environment_context>\n  <cwd>/repo</cwd>\n</environment_context>",
            0n,
          ),
          user("# AGENTS.md instructions for /repo\n\n<INSTRUCTIONS>", 1n),
          user("Real prompt", 2n),
        ])
        .map((item) => [item.role, item.kind]),
    ).toEqual([
      ["SYSTEM", "META"],
      ["SYSTEM", "META"],
      ["USER", "TEXT"],
    ]);
  });

  it("projects FileChange items as apply_patch calls with file operations and attaches Codex-parsed reads to the owning exec call @req R-HRN-02", () => {
    const records = jsonl("codex/edit-with-subagent.jsonl");
    const messages = codex.toMessages(records);
    const patch = messages.find(
      (item) => item.kind === "TOOL_USE" && item.toolName === "apply_patch",
    );
    expect(patch?.toolUseId).toBe("exec-c9d35c77-822c-4da8-911d-4be8efe549f0");
    expect(patch?.files).toEqual([
      {
        path: "/tmp/agentcommons-live-canary-72D1ld/codex/repo/notes.txt",
        ops: ["edit"],
      },
    ]);
    expect(patch?.toolInput).toMatchObject({
      "/tmp/agentcommons-live-canary-72D1ld/codex/repo/notes.txt": {
        type: "update",
      },
    });
    const result = messages.find(
      (item) =>
        item.kind === "TOOL_RESULT" && item.toolUseId === patch?.toolUseId,
    );
    expect(result?.toolName).toBe("apply_patch");
    expect(result?.content).toContain("Success. Updated the following files");
    expect(
      messages
        .filter((item) => item.kind === "TOOL_USE" && item.toolName === "exec")
        .flatMap((item) => item.files ?? []),
    ).toEqual([
      {
        path: "/tmp/agentcommons-live-canary-72D1ld/codex/repo/probe.txt",
        ops: ["read"],
      },
      {
        path: "/tmp/agentcommons-live-canary-72D1ld/codex/repo/notes.txt",
        ops: ["read"],
      },
      {
        path: "/tmp/agentcommons-live-canary-72D1ld/codex/repo/notes.txt",
        ops: ["read"],
      },
    ]);
    const uses = new Set(
      messages
        .filter((item) => item.kind === "TOOL_USE")
        .map((item) => item.toolUseId),
    );
    expect(uses.size).toBe(8);
    expect(
      messages
        .filter((item) => item.kind === "TOOL_RESULT")
        .every((item) => uses.has(item.toolUseId)),
    ).toBe(true);
    const projection = projectTrace(
      {
        id: "00000000-0000-4000-8000-000000000001",
        harness: "CODEX",
        cwd: "/tmp/agentcommons-live-canary-72D1ld/codex/repo",
        repoRoot: "/tmp/agentcommons-live-canary-72D1ld/codex/repo",
        normalizerContext: {},
        projectedContext: {},
      },
      records,
      [],
    );
    expect(projection?.files).toEqual([
      { path: "probe.txt", ops: ["read"] },
      { path: "notes.txt", ops: ["edit", "read"] },
    ]);
  });

  it("keeps inter-agent messages as searchable system text and names subagent threads by agent_path @req R-HRN-02", () => {
    const parent = codex.toMessages(jsonl("codex/edit-with-subagent.jsonl"));
    const answer = parent.find(
      (item) => item.role === "SYSTEM" && item.kind === "TEXT",
    );
    expect(answer?.content).toContain("Message Type: FINAL_ANSWER");
    expect(answer?.content).toContain("AgentCommons observed git state codex.");
    expect(answer ? searchableMessage(answer).searchable : false).toBe(true);
    const child = jsonl("codex/edit-subagent-child.jsonl");
    expect(codex.sessionDelta(child)).toMatchObject({
      title: "/root/probe_read",
      harnessSessionId: "01a0826e-3513-7033-89ce-97433f12deaa",
    });
    expect(codex.sessionDelta(child).firstPrompt).toBeUndefined();
    expect(codex.links(child)).toEqual([
      {
        relation: "SUBAGENT",
        parentNativeRef: "01a0826d-cdbe-77e1-b486-924639bd791c",
      },
    ]);
    const messages = codex.toMessages(child);
    expect(messages.filter((item) => item.role === "USER")).toHaveLength(0);
    expect(
      messages.find((item) => item.role === "SYSTEM" && item.kind === "TEXT")
        ?.content,
    ).toContain("Message Type: NEW_TASK");
    // Encrypted inter-agent payload blocks are never projected as text.
    expect(messages.some((item) => item.content.includes("gAAAA"))).toBe(false);
  });
  // The child rollout carries agent_role null and the random nickname "Lagrange";
  // the hook reports agent_type "default", which the header keeps when the delta is empty.
  it("derives agent_type from a configured agent_role and never from the random nickname @req R-HRN-02", () => {
    const child = jsonl("codex/edit-subagent-child.jsonl");
    expect(codex.sessionDelta(child).agentType).toBeUndefined();
    const meta = child[0]?.payload;
    if (!meta) throw new Error("Missing child session_meta.");
    const withRole = (payload: Record<string, unknown>) =>
      codex.sessionDelta([source({ ...meta, payload }, 0n)]).agentType;
    const native = payloadSchema.parse(meta.payload);
    expect(withRole({ ...native, agent_role: "explorer" })).toBe("explorer");
    expect(
      withRole({
        ...native,
        source: {
          subagent: {
            thread_spawn: {
              parent_thread_id: "01a0826d-cdbe-77e1-b486-924639bd791c",
              agent_role: "reviewer",
              agent_nickname: "Lagrange",
            },
          },
        },
      }),
    ).toBe("reviewer");
    expect(withRole({ ...native, agent_role: null })).toBeUndefined();
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
  it("maps the extension's host metadata to harness_version and entrypoint @req R-HRN-06", () => {
    const records = jsonl("pi/cli-tool.jsonl");
    const observed = pi.sessionDelta(records, {
      transcriptMetadata: {
        harnessVersion: "0.73.1",
        entrypoint: "interactive",
      },
    });
    expect(observed.harnessVersion).toBe("0.73.1");
    expect(observed.entrypoint).toBe("interactive");
    expect(observed.harnessSessionId).toBe(
      "01a07deb-d8cc-7158-bdc6-d421ec5341f4",
    );
    // The transcript itself never provides either value.
    const bare = pi.sessionDelta(records, {});
    expect(bare.harnessVersion).toBeUndefined();
    expect(bare.entrypoint).toBeUndefined();
    expect(
      pi.sessionDelta(records, { transcriptMetadata: { entrypoint: 7 } })
        .entrypoint,
    ).toBeUndefined();
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
