import { expect, it } from "vitest";
import { NORMALIZERS } from "../normalizers/index.js";
import type { Harness } from "../normalizers/types.js";
import { maskToolResults } from "./tool-results.js";
import {
  geminiMessages,
  jsonlRecords,
  sourceRecord,
} from "../test/fixtures.js";

const directory = new URL(
  "../../../fixtures/transcripts/tool-identities/",
  import.meta.url,
);
// @req R-RED-01
it.each<[Harness, string]>([
  ["CLAUDE_CODE", "claude.jsonl"],
  ["CODEX", "codex.jsonl"],
  ["GEMINI_CLI", "gemini.json"],
  ["PI", "pi.jsonl"],
])(
  "pairs captured %s results from compact server-owned classifications without historical payloads",
  (harness, file) => {
    const url = new URL(file, directory);
    const records = file.endsWith(".json")
      ? geminiMessages(url).map((payload, pos) => sourceRecord(payload, pos))
      : jsonlRecords(url);
    const adapter = NORMALIZERS[harness];
    const full = maskToolResults(adapter, records);
    const classifications = full.flatMap(
      (record) => record.redactionContext?.toolCalls ?? [],
    );
    expect(classifications.length).toBeGreaterThan(0);
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
