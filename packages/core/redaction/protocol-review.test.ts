import { describe, expect, it } from "vitest";
import { NORMALIZERS } from "../normalizers/index.js";
import {
  Redactor,
  canonicalIdentity,
  identityDigest,
  sanitizeSourceRecord,
  maskToolResults,
  redactNormalizerContext,
  redactSourceRecord,
} from "./index.js";
import { sourceRecord } from "../test/fixtures.js";

function policy(pattern: string) {
  return new Redactor([
    {
      id: "review-policy",
      name: "review-policy",
      kind: "REGEX",
      pattern,
      flags: "g",
      enabled: true,
      builtin: false,
      replacement: "[masked]",
    },
  ]);
}

describe("redaction preserves protocol without exempting content", () => {
  // @req R-RED-01
  it("preserves only declared keys and enum values while redacting matching free text and unknown keys", async () => {
    const redactor = policy(
      "assistant|tool_use|message|content|type|text|Read",
    );
    const source = sourceRecord({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "assistant content", futureField: "assistant" },
          {
            type: "tool_use",
            id: "call-a",
            name: "Read",
            input: { file_path: "/repo/readme.md" },
          },
        ],
      },
      assistant: "assistant",
    });
    const result = await redactSourceRecord(
      NORMALIZERS.CLAUDE_CODE,
      source,
      redactor,
    );
    const messages = NORMALIZERS.CLAUDE_CODE.toMessages([result.value]);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      role: "ASSISTANT",
      kind: "TEXT",
      content: "[masked] [masked]",
    });
    expect(messages[1]).toMatchObject({
      kind: "TOOL_USE",
      toolName: "[masked]",
    });
    expect(JSON.stringify(result.value.payload)).not.toContain(
      '"futureField":"assistant"',
    );
    expect(result.value.payload).not.toHaveProperty("assistant");
    expect(result.value.payload).toHaveProperty("[masked]", "[masked]");
  });

  it("keeps typed timestamps and identity references usable under matching policies", async () => {
    const redactor = policy("2026|leaf|parent");
    const original = sourceRecord({
      type: "message",
      id: "leaf",
      parentId: "parent",
      timestamp: "2026-09-07T00:00:00Z",
      message: {
        role: "user",
        content: [{ type: "text", text: "2026 leaf parent" }],
      },
    });
    const safe = await redactSourceRecord(NORMALIZERS.PI, original, redactor);
    const repeated = await redactSourceRecord(
      NORMALIZERS.PI,
      safe.value,
      redactor,
    );
    expect(repeated.value).toEqual(safe.value);
    const context = await redactNormalizerContext(
      {
        activeLeafId: "leaf",
        transcriptMetadata: {
          sessionId: "parent",
          startTime: "2026-09-07T00:00:00Z",
          unknown: "leaf",
        },
      },
      redactor,
    );
    expect(context.value.activeLeafId).toMatch(/^redacted-[a-f0-9]{64}$/);
    expect(context.value.transcriptMetadata?.startTime).toBe(
      "2026-09-07T00:00:00Z",
    );
    expect(context.value.transcriptMetadata?.unknown).toBe("[masked]");
    expect(
      (
        await canonicalIdentity(
          String(context.value.activeLeafId),
          policy("redacted"),
        )
      ).value,
    ).toBe(context.value.activeLeafId);
  });

  it("pairs a newly redacted result with its old input even before a policy rescan", async () => {
    const normalizer = NORMALIZERS.CLAUDE_CODE;
    const input = sourceRecord({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            id: "call-before-policy",
            name: "Read",
            input: { file_path: "/repo/notes" },
          },
        ],
      },
    });
    const initial = await redactSourceRecord(
      normalizer,
      maskToolResults(normalizer, [input])[0] ?? input,
      new Redactor(),
    );
    const result = sourceRecord(
      {
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "call-before-policy",
              content: "safe result",
            },
          ],
        },
      },
      1,
    );
    const masked = maskToolResults(
      normalizer,
      [result],
      initial.value.redactionContext?.toolCalls ?? [],
    );
    const safe = await redactSourceRecord(
      normalizer,
      masked[0] ?? result,
      policy("call-before-policy"),
    );
    const messages = normalizer.toMessages([initial.value, safe.value]);
    expect(messages[0]?.toolUseId).toBe(messages[1]?.toolUseId);
    expect(messages[1]?.toolName).toBe("Read");
  });

  // @req R-RED-05
  it("removes unknown mirrors inside Codex and Gemini sensitive result containers", () => {
    const privateText = "private plain text with no credential pattern";
    const codex = NORMALIZERS.CODEX;
    const use = sourceRecord({
      type: "response_item",
      payload: {
        type: "custom_tool_call",
        call_id: "call-a",
        name: "apply_patch",
        input: "*** Update File: /repo/.env\n+hidden",
      },
    });
    const output = sourceRecord(
      {
        type: "response_item",
        payload: {
          type: "custom_tool_call_output",
          call_id: "call-a",
          output: privateText,
          future_mirror: { text: privateText },
        },
      },
      1,
    );
    expect(
      JSON.stringify(
        maskToolResults(codex, [use, output]).map((item) => item.payload),
      ),
    ).not.toContain(privateText);
    const gemini = sourceRecord({
      type: "gemini",
      toolCalls: [
        {
          id: "call-b",
          name: "read_file",
          args: { file_path: "/repo/.env" },
          result: [{ functionResponse: { response: { output: privateText } } }],
          futureMirror: privateText,
        },
      ],
    });
    expect(
      JSON.stringify(
        maskToolResults(NORMALIZERS.GEMINI_CLI, [gemini]).map(
          (item) => item.payload,
        ),
      ),
    ).not.toContain(privateText);
  });
});

// @req R-RED-01
it("treats exact configured replacement strings as terminal output across rescans", async () => {
  const redactor = new Redactor([
    {
      id: "private-policy",
      name: "private",
      kind: "REGEX",
      pattern: "private",
      flags: "g",
      enabled: true,
      builtin: false,
    },
  ]);
  const first = await redactor.text("private material");
  expect(first.value).toBe("[REDACTED:private] material");
  const second = await redactor.text(first.value);
  expect(second.value).toBe(first.value);
  expect(second.counts).toEqual([]);
  const blanket = policy(".+");
  const all = await blanket.text("first [masked] second");
  expect(all.value).toBe("[masked][masked][masked]");
  expect((await blanket.text(all.value)).value).toBe(all.value);
  expect(
    (await redactor.text("[REDACTED:unknown-private-value]")).value,
  ).not.toContain("unknown-private-value");
});

it("keeps configured structural output markers idempotent and bounds oversized identities", async () => {
  const source = sourceRecord({
    type: "assistant",
    message: {
      id: "x".repeat(1024),
      content: [{ type: "tool_use", id: "id-secret", name: "Read", input: {} }],
    },
  });
  const redactor = policy("id-secret|redacted");
  const first = await redactSourceRecord(
    NORMALIZERS.CLAUDE_CODE,
    source,
    redactor,
  );
  const second = await redactSourceRecord(
    NORMALIZERS.CLAUDE_CODE,
    first.value,
    redactor,
  );
  expect(second.value).toEqual(first.value);
  expect(second.counts).toEqual([]);
  expect(
    first.value.redactionContext?.identities.every(
      (item) => item.canonicalId.length <= 256,
    ),
  ).toBe(true);
});

it("drops identity paths removed by whole-record sanitization without weakening sensitive classification", async () => {
  const source = sourceRecord({
    type: "assistant",
    message: {
      id: "message-a",
      content: Array.from({ length: 600_000 }, () => 1),
    },
  });
  source.redactionContext = {
    toolCalls: [{ idHash: identityDigest("call-a"), sensitive: true }],
    identities: [
      {
        path: ["message", "id"],
        canonicalId: "message-a",
        idHash: identityDigest("message-a"),
      },
    ],
  };
  const sanitized = sanitizeSourceRecord(source);
  expect(sanitized.redactionContext?.identities).toEqual([]);
  expect(sanitized.redactionContext?.toolCalls).toEqual(
    source.redactionContext.toolCalls,
  );
  expect(NORMALIZERS.CLAUDE_CODE.toMessages([sanitized])).toEqual([]);
  expect(
    (
      await redactSourceRecord(
        NORMALIZERS.CLAUDE_CODE,
        sanitized,
        new Redactor(),
      )
    ).value.redactionContext,
  ).toEqual(sanitized.redactionContext);
});
