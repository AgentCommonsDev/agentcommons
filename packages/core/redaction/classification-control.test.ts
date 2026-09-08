import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { z } from "zod";
import { NORMALIZERS } from "../normalizers/index.js";
import type { Harness, SourceRecord } from "../normalizers/types.js";
import { maskToolResults } from "./tool-results.js";

const directory = new URL(
  "../../../fixtures/transcripts/tool-identities/",
  import.meta.url,
);
const object = z.looseObject({});
function source(payload: Record<string, unknown>, pos: number): SourceRecord {
  return {
    id: `record-${String(pos)}`,
    pos: BigInt(pos),
    sourceVersion: 0,
    key: null,
    payload,
    receivedAt: new Date("2026-09-08T06:00:00Z"),
  };
}
// @req R-RED-01
it.each<[Harness, string]>([
  ["CLAUDE_CODE", "claude.jsonl"],
  ["CODEX", "codex.jsonl"],
  ["GEMINI_CLI", "gemini.json"],
  ["PI", "pi.jsonl"],
])(
  "pairs captured %s results from compact server-owned classifications without historical payloads",
  (harness, file) => {
    const text = readFileSync(new URL(file, directory), "utf8");
    const records = file.endsWith(".json")
      ? z
          .object({ messages: z.array(object) })
          .parse(JSON.parse(text) as unknown)
          .messages.map(source)
      : text
          .trimEnd()
          .split("\n")
          .map((line, pos) =>
            source(object.parse(JSON.parse(line) as unknown), pos),
          );
    const adapter = NORMALIZERS[harness];
    const full = maskToolResults(adapter, records);
    const classifications = full.flatMap((record) =>
      (record.redactionContext?.toolCalls ?? []).map((call) => ({
        ...record,
        payload: {},
        redactionContext: { toolCalls: [call], identities: [] },
      })),
    );
    expect(classifications.length).toBeGreaterThan(0);
    expect(adapter.toolUses(classifications)).toEqual([]);
    const resultRecords = full.filter(
      (record) => adapter.toolResults(record).length > 0,
    );
    expect(resultRecords.length).toBeGreaterThan(0);
    expect(
      maskToolResults(adapter, resultRecords, classifications).map(
        (record) => record.payload,
      ),
    ).toEqual(resultRecords.map((record) => record.payload));
  },
);
