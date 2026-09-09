import { readFileSync } from "node:fs";
import { z } from "zod";
import type { SourceRecord } from "../normalizers/types.js";

const payloadSchema = z.looseObject({});

/**
 * A synthetic source record as the ingest service builds one: `record-<pos>`, no key and
 * version 0 unless a test needs otherwise.
 */
export function sourceRecord(
  payload: Record<string, unknown>,
  pos: number | bigint = 0,
  overrides: Partial<
    Pick<SourceRecord, "id" | "key" | "sourceVersion" | "receivedAt">
  > = {},
): SourceRecord {
  return {
    id: `record-${String(pos)}`,
    pos: BigInt(pos),
    key: null,
    sourceVersion: 0,
    receivedAt: new Date("2026-09-07T00:00:00Z"),
    payload,
    ...overrides,
  };
}
/** One record per line of a JSONL transcript fixture, positioned by line index. */
export function jsonlRecords(url: URL): SourceRecord[] {
  return readFileSync(url, "utf8")
    .trimEnd()
    .split("\n")
    .map((line, pos) =>
      sourceRecord(payloadSchema.parse(JSON.parse(line) as unknown), pos),
    );
}
/** The `messages` of a Gemini CLI JSON document fixture, as the json-document reader hands them over. */
export function geminiMessages(url: URL): Record<string, unknown>[] {
  return z
    .looseObject({ messages: z.array(payloadSchema) })
    .parse(JSON.parse(readFileSync(url, "utf8")) as unknown).messages;
}
