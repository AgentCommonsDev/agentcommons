import { describe, expect, it } from "vitest";
import { NORMALIZERS } from "../normalizers/index.js";
import type { Harness, SourceRecord } from "../normalizers/types.js";
import { maskToolResults, UnpairedToolResultError } from "./tool-results.js";
import { Redactor } from "./index.js";
import { builtinPolicies, policyDefinitionSchema } from "./policy.js";
import { sanitizeRecord } from "./sanitize.js";
import { jsonByteLength } from "../schemas/common.js";
import { sourceRecord } from "../test/fixtures.js";

/** The persisted record limit (§6): 1 MiB of JSON. */
const recordByteLimit = 1024 * 1024;

/** Records carrying source keys, as the Claude Code and pi readers send them. */
const source = (payload: Record<string, unknown>, pos: number) =>
  sourceRecord(payload, pos, { key: `key-${String(pos)}` });
const secret = "a private value without a recognizable token format";
const cases: { harness: Harness; records: SourceRecord[] }[] = [
  {
    harness: "CLAUDE_CODE",
    records: [
      source(
        {
          type: "assistant",
          message: {
            content: [
              {
                type: "tool_use",
                id: "call",
                name: "Read",
                input: { file_path: "/repo/.env.local" },
              },
            ],
          },
        },
        0,
      ),
      source(
        {
          type: "user",
          message: {
            content: [
              {
                type: "tool_result",
                tool_use_id: "call",
                content: secret,
                unknown_output: secret,
              },
            ],
          },
          toolUseResult: { file: { content: secret } },
        },
        1,
      ),
    ],
  },
  {
    harness: "GEMINI_CLI",
    records: [
      source(
        {
          type: "gemini",
          toolCalls: [
            {
              id: "call",
              name: "read_file",
              args: { file_path: "/repo/credentials.json" },
              result: [
                {
                  functionResponse: {
                    response: { output: secret, hidden: secret },
                  },
                },
              ],
              resultDisplay: { text: secret },
            },
          ],
        },
        0,
      ),
    ],
  },
  {
    harness: "CODEX",
    records: [
      source(
        {
          type: "response_item",
          payload: {
            type: "custom_tool_call",
            call_id: "call",
            name: "apply_patch",
            input: "*** Update File: .npmrc\n@@\n-old\n+new",
          },
        },
        0,
      ),
      source(
        {
          type: "response_item",
          payload: {
            type: "custom_tool_call_output",
            call_id: "call",
            output: [{ type: "input_text", text: secret }],
          },
        },
        1,
      ),
    ],
  },
  {
    harness: "PI",
    records: [
      source(
        {
          type: "message",
          id: "one",
          parentId: null,
          message: {
            role: "assistant",
            content: [
              {
                type: "toolCall",
                id: "call",
                name: "read",
                arguments: { path: "id_rsa.pub" },
              },
            ],
          },
        },
        0,
      ),
      source(
        {
          type: "message",
          id: "two",
          parentId: "one",
          message: {
            role: "toolResult",
            toolCallId: "call",
            toolName: "read",
            content: [{ type: "text", text: secret }],
            details: { extra: secret },
          },
        },
        1,
      ),
    ],
  },
];

describe("sensitive result source protection", () => {
  // @req R-RED-05 @req R-HRN-01 @req R-HRN-04 @req R-HRN-06
  it.each(cases)(
    "masks $harness source outputs and mirrors before normalization",
    ({ harness, records }) => {
      const normalizer = NORMALIZERS[harness];
      const masked = maskToolResults(normalizer, records);
      expect(
        JSON.stringify(masked.map((record) => record.payload)),
      ).not.toContain(secret);
      const results = normalizer
        .toMessages(masked)
        .filter((message) => message.kind === "TOOL_RESULT");
      expect(results).toHaveLength(1);
      expect(results[0]?.content).toContain("sensitive file output redacted");
      expect(JSON.stringify(records.map((record) => record.payload))).toContain(
        secret,
      );
    },
  );
  // @req R-RED-05
  it("defers unpaired results and uses prior-batch inputs without changing raw originals", () => {
    const fixture = cases[0];
    if (!fixture) throw new Error("Missing case");
    const [input, result] = fixture.records;
    if (!input || !result) throw new Error("Missing source records");
    expect(() => maskToolResults(NORMALIZERS.CLAUDE_CODE, [result])).toThrow(
      UnpairedToolResultError,
    );
    expect(() => maskToolResults(NORMALIZERS.CLAUDE_CODE, [result])).toThrow(
      expect.objectContaining({ records: [{ pos: 1, key: "key-1" }] }),
    );
    // The server passes the classifications it stored for the earlier batch, never the
    // earlier payloads.
    const knownCalls = maskToolResults(NORMALIZERS.CLAUDE_CODE, [
      input,
    ]).flatMap((record) => record.redactionContext?.toolCalls ?? []);
    expect(knownCalls.map((call) => call.sensitive)).toEqual([true]);
    expect(
      JSON.stringify(
        maskToolResults(NORMALIZERS.CLAUDE_CODE, [result], knownCalls)[0]
          ?.payload,
      ),
    ).not.toContain(secret);
  });
  it("recognizes the exact sensitive filename families", () => {
    const masked = (path: string) => {
      const records = [
        source(
          {
            type: "assistant",
            message: {
              content: [
                {
                  type: "tool_use",
                  id: "call",
                  name: "Read",
                  input: { file_path: path },
                },
              ],
            },
          },
          0,
        ),
        source(
          {
            type: "user",
            message: {
              content: [
                { type: "tool_result", tool_use_id: "call", content: secret },
              ],
            },
          },
          1,
        ),
      ];
      return !JSON.stringify(
        maskToolResults(NORMALIZERS.CLAUDE_CODE, records).map(
          (record) => record.payload,
        ),
      ).includes(secret);
    };
    for (const file of [
      ".env",
      "dir/.env.prod",
      "key.pem",
      "dir/key.key",
      "id_rsa",
      "credentials.json",
      ".npmrc",
      ".netrc",
    ])
      expect(masked(file), file).toBe(true);
    for (const file of [
      "environment.ts",
      "public-key.ts",
      "config.json",
      "dotenv.ts",
    ])
      expect(masked(file), file).toBe(false);
  });
});

describe("structured redaction and sanitization", () => {
  // @req R-RED-02
  it("loads every shipped policy through the same persisted-policy validation", () => {
    for (const { id, builtin, ...definition } of builtinPolicies) {
      expect(policyDefinitionSchema.safeParse(definition).success, id).toBe(
        true,
      );
      expect(builtin).toBe(true);
    }
  }, 30_000);
  // @req R-RED-02
  it("does not restart JWT matching at each hyphen inside a long invalid token", () => {
    const policy = builtinPolicies.find((policy) => policy.name === "jwt");
    if (!policy || policy.kind !== "REGEX")
      throw new Error("Missing JWT policy");
    const start = performance.now();
    expect(
      new RegExp(policy.pattern, policy.flags).test(
        "eyJJ-".repeat(100_000) + "\0",
      ),
    ).toBe(false);
    expect(performance.now() - start).toBeLessThan(500);
  });
  // @req R-RED-01 @req R-RED-02
  it("preserves JSON property context for uppercase and generic assignments", async () => {
    const redactor = new Redactor();
    const value = "unrecognizablePrivateValue1234";
    const result = await redactor.json({
      TOKEN: value,
      nested: { api_key: value, password: value },
      harmless: "normal prose",
    });
    expect(JSON.stringify(result.value)).not.toContain(value);
    expect(result.value).toMatchObject({ harmless: "normal prose" });
    expect(
      (await redactor.text(JSON.stringify({ TOKEN: value }))).value,
    ).not.toContain(value);
  });
  // @req R-ING-11
  it("bounds structural overhead and huge keys with a record omission", () => {
    const value = {
      type: "unknown",
      items: Array.from({ length: 600_000 }, () => 1),
    };
    expect(jsonByteLength(value)).toBeGreaterThan(recordByteLimit);
    const result = sanitizeRecord(value);
    expect(jsonByteLength(result)).toBeLessThanOrEqual(recordByteLimit);
    expect(JSON.stringify(result)).toContain("_agentcommons_omitted");
    expect(JSON.stringify(result)).toContain("sha256");
    expect(
      jsonByteLength(sanitizeRecord({ ["x".repeat(recordByteLimit + 1)]: 1 })),
    ).toBeLessThan(recordByteLimit);
  });
  // @req R-ING-11
  it("replaces captured native image containers and data URIs", () => {
    const value = {
      content: [
        {
          type: "image",
          source: { type: "base64", media_type: "image/png", data: "YWJj" },
        },
        { inlineData: { mimeType: "image/jpeg", data: "YWJj" } },
        { type: "image", mimeType: "image/png", data: "YWJj" },
        "data:image/webp;base64,YWJj",
      ],
    };
    const result = JSON.stringify(sanitizeRecord(value));
    expect(result).not.toContain("YWJj");
    expect(result.match(/3 bytes/g)).toHaveLength(4);
  });
});
