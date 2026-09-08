import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  claudeCode,
  codex,
  geminiCli,
  pi,
  SourceNotReadyError,
} from "./index.js";
import type { SourceRecord } from "./types.js";

function source(payload: Record<string, unknown>, pos: number): SourceRecord {
  return {
    id: `record-${String(pos)}`,
    pos: BigInt(pos),
    sourceVersion: 0,
    key: null,
    payload,
    receivedAt: new Date("2026-09-07T00:00:00Z"),
  };
}
function tokenEvent(output: number | null, pos: number): SourceRecord {
  return source(
    {
      type: "event_msg",
      payload: {
        type: "token_count",
        info:
          output === null
            ? null
            : {
                total_token_usage: { input_tokens: 10, output_tokens: output },
              },
      },
    },
    pos,
  );
}
describe("cumulative token regression", () => {
  // @req R-HRN-01
  it("retains Claude per-message high watermarks when a later snapshot decreases", () => {
    const records = [10, 5, 10].map((output_tokens, pos) =>
      source(
        {
          type: "assistant",
          message: {
            id: "same-message",
            content: [{ type: "text", text: "part" }],
            usage: { input_tokens: 10, output_tokens },
          },
        },
        pos,
      ),
    );
    const messages = claudeCode.toMessages(records.reverse());
    expect(messages.map((message) => message.outputTokens)).toEqual([
      10n,
      0n,
      0n,
    ]);
    expect(
      messages.reduce((sum, message) => sum + (message.inputTokens ?? 0n), 0n),
    ).toBe(10n);
  });
  // @req R-ING-14
  it("does not infer a Codex reset from decreasing cumulative events", () => {
    const messages = codex.toMessages([
      tokenEvent(10, 0),
      tokenEvent(5, 1),
      tokenEvent(null, 2),
      tokenEvent(10, 3),
    ]);
    expect(messages.map((message) => message.outputTokens)).toEqual([
      10n,
      0n,
      null,
      0n,
    ]);
  });
  // @req R-ING-14
  it("allows a reset after explicit resume but preserves counters that continue", () => {
    const metadata = (pos: number) =>
      source(
        {
          type: "session_meta",
          payload: { id: "same-session", base_instructions: "instructions" },
        },
        pos,
      );
    const resumed = [
      metadata(0),
      tokenEvent(10, 1),
      metadata(2),
      tokenEvent(null, 3),
      tokenEvent(5, 4),
      tokenEvent(7, 5),
    ];
    expect(
      codex.toMessages(resumed).map((message) => message.outputTokens),
    ).toEqual([null, 10n, null, 5n, 2n]);
    const continuous = [
      metadata(0),
      tokenEvent(10, 1),
      metadata(2),
      tokenEvent(15, 3),
      tokenEvent(12, 4),
    ];
    expect(
      codex.toMessages(continuous).map((message) => message.outputTokens),
    ).toEqual([null, 10n, 5n, 0n]);
  });
});
// @req R-ING-12
it("does not derive Claude metadata or links from an unknown record type", () => {
  const records = [
    source(
      {
        type: "future_record",
        aiTitle: "unrecognized title",
        cwd: "/unrecognized",
        sessionId: "unrecognized",
        isSidechain: true,
        agentId: "unrecognized",
        timestamp: "2020-01-01T00:00:00Z",
      },
      0,
    ),
  ];
  expect(claudeCode.toMessages(records)).toEqual([]);
  expect(claudeCode.sessionDelta(records)).toEqual({ modelsUsed: [] });
  expect(claudeCode.links(records)).toEqual([]);
});
// @req R-HRN-04
it("derives Gemini session identity and start time from the captured document header context", () => {
  const document = z
    .looseObject({ messages: z.array(z.looseObject({})) })
    .parse(
      JSON.parse(
        readFileSync(
          new URL(
            "../../../fixtures/transcripts/gemini-cli/05-final.json",
            import.meta.url,
          ),
          "utf8",
        ),
      ) as unknown,
    );
  const { messages, ...transcriptMetadata } = document;
  const records = messages.map((message, pos) => source(message, pos));
  const context = {
    transcriptMetadata: z
      .record(z.string(), z.json())
      .parse(transcriptMetadata),
  };
  const delta = geminiCli.sessionDelta(records, context);
  expect(delta.harnessSessionId).toBe(document.sessionId);
  expect(delta.startedAt?.toISOString()).toBe(document.startTime);
  expect(geminiCli.sessionDelta(records, context)).toEqual(delta);
});
describe("pi partial source projection", () => {
  const header = source({ type: "session", id: "session" }, 0);
  const first = source(
    {
      type: "message",
      id: "first",
      parentId: null,
      message: { role: "user", content: "first prompt" },
    },
    1,
  );
  const next = source(
    {
      type: "message",
      id: "next",
      parentId: "first",
      message: { role: "assistant", content: "next reply" },
    },
    2,
  );
  // @req R-HRN-06
  it("signals a missing leaf instead of returning an empty replacement projection", () => {
    expect(() =>
      pi.toMessages([header, first], { activeLeafId: "next" }),
    ).toThrow(SourceNotReadyError);
    expect(() =>
      pi.sessionDelta([header, first], { activeLeafId: "next" }),
    ).toThrow(SourceNotReadyError);
    expect(
      pi
        .toMessages([header, first, next], { activeLeafId: "next" })
        .map((message) => message.content),
    ).toEqual(["first prompt", "next reply"]);
  });
  // @req R-HRN-06
  it("signals a missing ancestor and preserves explicit empty branches", () => {
    expect(() =>
      pi.toMessages([header, next], { activeLeafId: "next" }),
    ).toThrow(SourceNotReadyError);
    expect(pi.toMessages([header], {})).toEqual([]);
    expect(
      pi.toMessages([header, first, next], { activeLeafId: null }),
    ).toEqual([]);
  });
  it("ignores an unknown record without a native id when choosing the default leaf", () => {
    expect(
      pi
        .toMessages([header, first, source({ type: "future_record" }, 3)])
        .map((message) => message.content),
    ).toEqual(["first prompt"]);
  });
});
