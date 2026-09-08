import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const fixtures = new URL("../fixtures/", import.meta.url);
function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected a captured object");
  }
  return value as Record<string, unknown>;
}
function rows(path: string): Record<string, unknown>[] {
  return readFileSync(new URL(path, fixtures), "utf8")
    .trim()
    .split("\n")
    .map((line) => object(JSON.parse(line) as unknown));
}
function document(path: string): Record<string, unknown> {
  return object(
    JSON.parse(readFileSync(new URL(path, fixtures), "utf8")) as unknown,
  );
}
function messages(path: string): Record<string, unknown>[] {
  const value = document(`transcripts/gemini-cli/${path}.json`).messages;
  if (!Array.isArray(value))
    throw new Error("Captured document lacks messages");
  return (value as unknown[]).map(object);
}
function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

describe("live-captured harness contracts", () => {
  // @req R-LNK-05
  it.each([
    ["claude-code-2.1.263", "93db0511-4472-4f3b-90be-899be97a89d1"],
    ["gemini-cli-0.35.3", "e8c0026d-b5c8-49ec-af84-6eaf5fa5ced5"],
  ])(
    "live %s resume preserves session identity and explicitly identifies its source",
    (harness, id) => {
      const hooks = rows(`hooks/${harness}-resume-events.jsonl`);
      expect(
        hooks.find((row) => row.hook_event_name === "SessionStart"),
      ).toMatchObject({ source: "resume", session_id: id });
      expect(hooks.every((row) => row.session_id === id)).toBe(true);
      expect(hooks.some((row) => row.hook_event_name === "SessionEnd")).toBe(
        true,
      );
    },
  );
  it("checks real Gemini agent/tool payloads and in-place mutation evidence @req R-HRN-03", () => {
    const hooks = rows("hooks/gemini-cli-0.35.3-tool-events.jsonl");
    for (const hook of hooks) {
      for (const field of [
        "session_id",
        "transcript_path",
        "cwd",
        "hook_event_name",
        "timestamp",
      ]) {
        expect(hook[field]).toBeTypeOf("string");
      }
    }
    const beforeAgent = hooks.find(
      (row) => row.hook_event_name === "BeforeAgent",
    );
    const afterAgent = hooks.find(
      (row) => row.hook_event_name === "AfterAgent",
    );
    expect(beforeAgent?.prompt).toContain("read_file");
    expect(afterAgent?.prompt_response).toContain("capture-second-tool");
    expect(afterAgent?.stop_hook_active).toBeTypeOf("boolean");
    const toolStarts = hooks.filter(
      (row) => row.hook_event_name === "BeforeTool",
    );
    const toolEnds = hooks.filter((row) => row.hook_event_name === "AfterTool");
    expect(toolStarts.map((row) => row.tool_name).sort()).toEqual([
      "read_file",
      "run_shell_command",
    ]);
    expect(toolEnds.map((row) => row.tool_name).sort()).toEqual([
      "read_file",
      "run_shell_command",
    ]);
    for (const tool of toolEnds) {
      expect(tool.tool_input).toEqual(expect.any(Object));
      expect(tool.tool_response).toEqual(expect.any(Object));
    }
    const before = messages("02-before-tools");
    const duringAfterTool = messages("03-after-tools-hook");
    const after = messages("04-tools-persisted");
    expect(before).toHaveLength(after.length);
    const earlier = before[1];
    const updated = after[1];
    expect(earlier?.id).toBe(updated?.id);
    expect(earlier?.timestamp).toBe(updated?.timestamp);
    expect(hash(earlier)).not.toBe(hash(updated));
    expect(duringAfterTool[1]?.toolCalls).toBeUndefined();
    expect(updated?.toolCalls).toHaveLength(2);
    expect(
      hooks.filter((row) => row.hook_event_name === "SessionEnd"),
    ).toHaveLength(2);
  });

  it("checks pi tree navigation, fork provenance, resume identity, and paired tools", () => {
    const observations = rows("hooks/pi-0.73.1-lifecycle-events.jsonl");
    const tree = observations.find(
      (row) => object(row.event).type === "session_tree",
    );
    expect(tree).toBeDefined();
    const nativeTree = object(tree?.event);
    expect(tree?.activeLeafId).toBe(nativeTree.newLeafId);
    expect(nativeTree.newLeafId).not.toBe(nativeTree.oldLeafId);
    const source = rows("transcripts/pi/tree-and-resume.jsonl");
    const sourceIds = new Set(source.map((row) => row.id));
    expect(sourceIds.has(nativeTree.oldLeafId)).toBe(true);
    expect(sourceIds.has(nativeTree.newLeafId)).toBe(true);
    const entries = source.filter((row) => row.type !== "session");
    for (const entry of entries) {
      expect(entry.parentId === null || sourceIds.has(entry.parentId)).toBe(
        true,
      );
    }
    const childrenPerParent = new Map<unknown, number>();
    for (const entry of entries)
      childrenPerParent.set(
        entry.parentId,
        (childrenPerParent.get(entry.parentId) ?? 0) + 1,
      );
    expect([...childrenPerParent.values()].some((count) => count > 1)).toBe(
      true,
    );
    const fork = rows("transcripts/pi/fork.jsonl");
    expect(fork[0]?.id).not.toBe(source[0]?.id);
    expect(fork[0]?.parentSession).toContain(String(source[0]?.id));
    expect(fork[0]?.parentSession).toMatch(/\.jsonl$/);
    const starts = observations.filter(
      (row) => object(row.event).type === "session_start",
    );
    expect(starts.map((row) => object(row.event).reason)).toEqual([
      "startup",
      "fork",
      "resume",
    ]);
    expect(starts[0]?.sessionId).toBe(starts[2]?.sessionId);
    expect(starts[1]?.sessionId).toBe(fork[0]?.id);
    const toolCall = observations.find(
      (row) => object(row.event).type === "tool_call",
    );
    const toolResult = observations.find(
      (row) => object(row.event).type === "tool_result",
    );
    expect(object(toolCall?.event).toolCallId).toBe(
      object(toolResult?.event).toolCallId,
    );
    expect(object(toolResult?.event).isError).toBe(false);
    expect(object(toolResult?.event).content).toEqual([
      {
        type: "text",
        text: "AgentCommons pi live contract probe 2026-09-07.\n",
      },
    ]);
  });
});
