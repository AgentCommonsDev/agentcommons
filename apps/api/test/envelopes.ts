import { randomUUID } from "node:crypto";
import type { z } from "zod";
import {
  ingestEnvelopeSchema,
  type IngestEnvelope,
  type IngestRecord,
} from "@agentcommons/core";

type EnvelopeInput = z.input<typeof ingestEnvelopeSchema>;
type ContextInput = EnvelopeInput["context"];
/** Every field is optional; `context` and its `installation` merge over the defaults. */
type EnvelopeOverrides = Omit<Partial<EnvelopeInput>, "context"> & {
  context?: Omit<Partial<ContextInput>, "installation"> & {
    installation?: Partial<ContextInput["installation"]>;
  };
};

/**
 * One valid v2 ingest envelope with fresh identities and no records; tests state only
 * their deltas. The watermark covers every record given.
 */
export function testEnvelope(
  overrides: EnvelopeOverrides = {},
): IngestEnvelope {
  const { context = {}, records = [], ...rest } = overrides;
  const { installation = {}, ...contextRest } = context;
  return ingestEnvelopeSchema.parse({
    envelopeVersion: 2,
    hook: { sha256: "a".repeat(64), extensionSha256: null },
    harness: "CLAUDE_CODE",
    harnessSessionId: randomUUID(),
    batchId: randomUUID(),
    installationId: randomUUID(),
    behavior: "sync",
    nativeEvent: "Stop",
    start: null,
    sentAt: new Date().toISOString(),
    sourcePos: Math.max(0, ...records.map((record) => record.pos)),
    cursor: String(records.length),
    end: null,
    ...rest,
    records,
    context: {
      cwd: "/repo",
      installation: {
        hostname: "fixture",
        osUser: "developer",
        platform: "linux",
        arch: "x64",
        ...installation,
      },
      git: null,
      parentHint: null,
      ...contextRest,
    },
  });
}

/** One source record whose line is the JSON of `payload`; the key defaults to the position. */
export function sourceRecord(
  pos: number,
  payload: unknown,
  key: string | null = `record-${String(pos)}`,
): IngestRecord {
  return { pos, key, sourceVersion: 0, line: JSON.stringify(payload) };
}
/** A Claude Code user text message; `extra` merges into the transcript record. */
export function textRecord(
  pos: number,
  text: string,
  extra: Record<string, unknown> = {},
): IngestRecord {
  return sourceRecord(pos, {
    type: "user",
    uuid: `record-${String(pos)}`,
    message: { content: [{ type: "text", text }] },
    ...extra,
  });
}
/** A Claude Code assistant tool call; `extra` merges into the transcript record. */
export function toolUseRecord(
  pos: number,
  call: { id: string; name: string; input: unknown },
  extra: Record<string, unknown> = {},
): IngestRecord {
  return sourceRecord(pos, {
    type: "assistant",
    uuid: `record-${String(pos)}`,
    message: { content: [{ type: "tool_use", ...call }] },
    ...extra,
  });
}
/** Records for captured transcript lines at positions 0..n-1. */
export function lineRecords(
  lines: readonly string[],
  key: (pos: number) => string | null = (pos) => String(pos),
): IngestRecord[] {
  return lines.map((line, pos) => ({
    pos,
    key: key(pos),
    sourceVersion: 0,
    line,
  }));
}
