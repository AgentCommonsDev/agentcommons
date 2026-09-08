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
  kind: z.string(),
  messages: z.array(z.looseObject({ id: z.string() })),
});
function snapshot(name: string) {
  return documentSchema.parse(
    JSON.parse(readFileSync(new URL(name, directory), "utf8")),
  );
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
  const records: SourceRecord[] = final.messages.map((payload, pos) => ({
    id: payload.id,
    pos: BigInt(pos),
    key: payload.id,
    sourceVersion: 0,
    payload,
    receivedAt: new Date("2026-09-08T10:46:00Z"),
  }));
  const messages = geminiCli.toMessages(records);
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
  expect(geminiCli.links(records)).toEqual([]);
});
