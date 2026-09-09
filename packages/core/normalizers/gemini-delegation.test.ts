import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { z } from "zod";
import { geminiCli } from "./gemini-cli.js";
import type { SourceRecord } from "./types.js";

const directory = new URL(
  "../../../fixtures/transcripts/gemini-cli/delegation/",
  import.meta.url,
);
const documentSchema = z.looseObject({
  sessionId: z.string(),
  startTime: z.string(),
  kind: z.string(),
  messages: z.array(z.looseObject({ id: z.string() })),
});
function snapshot(name: string) {
  return documentSchema.parse(
    JSON.parse(readFileSync(new URL(name, directory), "utf8")),
  );
}
function records(document: ReturnType<typeof snapshot>): SourceRecord[] {
  return document.messages.map((payload, pos) => ({
    id: payload.id,
    pos: BigInt(pos),
    key: payload.id,
    sourceVersion: 0,
    payload,
    receivedAt: new Date("2026-09-08T10:46:00Z"),
  }));
}
function context(document: ReturnType<typeof snapshot>) {
  return {
    transcriptMetadata: {
      sessionId: document.sessionId,
      startTime: document.startTime,
      sourceRecordCount: document.messages.length,
    },
  };
}

// @req R-HRN-03 @req R-HRN-04
it("preserves actual Gemini generalist delegation as a native tool call without inventing a separate child session", () => {
  const hooks = readFileSync(
    new URL(
      "../../../fixtures/hooks/gemini-cli-0.35.3-delegation-events.jsonl",
      import.meta.url,
    ),
    "utf8",
  )
    .trimEnd()
    .split("\n")
    .map((line) =>
      z
        .looseObject({
          session_id: z.string(),
          transcript_path: z.string(),
          hook_event_name: z.string(),
          tool_name: z.string().optional(),
        })
        .parse(JSON.parse(line)),
    );
  expect(hooks).toHaveLength(30);
  expect(new Set(hooks.map((hook) => hook.session_id)).size).toBe(1);
  expect(new Set(hooks.map((hook) => hook.transcript_path)).size).toBe(1);
  expect(
    hooks
      .filter((hook) => hook.tool_name)
      .map((hook) => [hook.hook_event_name, hook.tool_name]),
  ).toEqual([
    ["BeforeTool", "generalist"],
    ["BeforeTool", "read_file"],
    ["AfterTool", "read_file"],
    ["AfterTool", "generalist"],
    ["BeforeTool", "read_file"],
    ["AfterTool", "read_file"],
  ]);
  const child = snapshot("03-child-completed.json");
  const resumed = snapshot("04-parent-resumed.json");
  const final = snapshot("05-final.json");
  expect(child.messages).toHaveLength(5);
  expect(resumed.messages).toHaveLength(2);
  expect([child.sessionId, resumed.sessionId, final.sessionId]).toEqual(
    Array<string>(3).fill(final.sessionId),
  );
  expect([child.kind, resumed.kind, final.kind]).toEqual([
    "main",
    "main",
    "main",
  ]);
  const source = records(final);
  const messages = geminiCli.toMessages(source);
  expect(
    messages
      .filter((message) => message.kind === "TOOL_USE")
      .map((message) => message.toolName),
  ).toEqual(["generalist", "read_file"]);
  expect(
    messages.find(
      (message) =>
        message.kind === "TOOL_RESULT" && message.toolName === "generalist",
    )?.content,
  ).toContain("NATIVE-GEMINI-DELEGATION-CONTRACT-20260908");
  expect(geminiCli.links(source)).toEqual([]);
});

// @req R-HRN-04
it("renders captured Gemini thoughts as readable thinking text instead of serialized JSON", () => {
  const final = snapshot("05-final.json");
  const thinking = geminiCli
    .toMessages(records(final), context(final))
    .filter((message) => message.kind === "THINKING");
  // Gemini CLI 0.35.3 records `{ subject, description, timestamp }` per thought.
  expect(thinking.length).toBeGreaterThanOrEqual(4);
  expect(thinking[0]?.role).toBe("ASSISTANT");
  expect(thinking[0]?.content).toMatch(
    /^\*\*Initiating the Process\*\*\n\nI've begun by initiating the `generalist` tool/,
  );
  for (const message of thinking) {
    expect(message.content.startsWith("{")).toBe(false);
    expect(message.content).not.toContain('"subject"');
    expect(message.content).not.toContain('"timestamp"');
  }
  // Older captures carried a plain `text`; a subject-only or text-only thought still renders.
  const legacy = geminiCli.toMessages([
    {
      id: "legacy",
      pos: 0n,
      key: "legacy",
      sourceVersion: 0,
      payload: {
        id: "legacy",
        type: "gemini",
        content: "",
        thoughts: [{ text: "plain thought" }, { subject: "Only a subject" }],
      },
      receivedAt: new Date("2026-09-08T10:46:00Z"),
    },
  ]);
  expect(legacy.map((message) => message.content)).toEqual([
    "plain thought",
    "Only a subject",
  ]);
});

// @req R-HRN-04
it("counts Gemini thought tokens as generated output and keeps prompt tokens as reported", () => {
  const final = snapshot("05-final.json");
  const messages = geminiCli.toMessages(records(final), context(final));
  const first = messages.find((message) => message.inputTokens !== null);
  // The first assistant record reports input 9383, output 33, thoughts 70, total 9486:
  // total = input + output + thoughts, so thoughts are generated output tokens.
  expect(first?.inputTokens).toBe(9383n);
  expect(first?.outputTokens).toBe(103n);
  const output = messages.reduce(
    (sum, message) => sum + (message.outputTokens ?? 0n),
    0n,
  );
  const native = final.messages.reduce((sum, message) => {
    const tokens = z
      .looseObject({
        tokens: z
          .looseObject({ output: z.number(), thoughts: z.number() })
          .optional(),
      })
      .parse(message).tokens;
    return sum + BigInt((tokens?.output ?? 0) + (tokens?.thoughts ?? 0));
  }, 0n);
  expect(output).toBe(native);
});

// @req R-HRN-04
it("derives the Gemini session identity and start time from the rewritten document header", () => {
  const final = snapshot("05-final.json");
  const delta = geminiCli.sessionDelta(records(final), context(final));
  expect(delta.harnessSessionId).toBe("0956cff8-7436-4168-9e96-faadff21341c");
  expect(delta.startedAt?.toISOString()).toBe("2026-09-08T10:45:40.020Z");
  expect(delta.model).toBe("gemini-2.5-flash");
  expect(delta.modelsUsed).toEqual(["gemini-2.5-flash"]);
  expect(delta.title).toMatch(/^Call the native generalist tool exactly once/);
  // Gemini writes neither a CLI version nor an entrypoint into the transcript or hook stdin.
  expect(delta.harnessVersion).toBeUndefined();
  expect(delta.entrypoint).toBeUndefined();
});
