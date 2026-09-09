import {
  closeSync,
  fstatSync,
  openSync,
  readSync,
  readFileSync,
  writeSync,
  fsyncSync,
  renameSync,
} from "node:fs";
import * as z from "zod";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { IngestRecord } from "@agentcommons/core/schemas/ingest";
import { hash, secureDirectory, writeAtomic } from "./files.js";
import type { HarnessDefinition } from "./harnesses.js";

export const cursorSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("jsonl"),
    offset: z.number().int().nonnegative(),
  }),
  z.strictObject({
    kind: z.literal("document"),
    entries: z.array(
      z.strictObject({
        hash: z.string(),
        version: z.number().int().nonnegative(),
      }),
    ),
    documentHash: z.string().nullable(),
    watermark: z.number().int().nonnegative(),
  }),
]);
export type SourceCursor = z.infer<typeof cursorSchema>;
export interface SourceRead {
  records: IngestRecord[];
  cursor: SourceCursor;
  sourcePos: number;
  transcriptMetadata?: Record<string, z.infer<ReturnType<typeof z.json>>>;
}
const MAX_RECORD = 50 * 1024 * 1024;
const TARGET_BATCH = 512 * 1024;
export class OversizedSourceRecord extends Error {
  constructor(
    readonly path: string,
    readonly pos: number,
    readonly documentLine?: string,
  ) {
    super("A source record exceeds the upload size limit.");
  }
}
export function initialCursor(definition: HarnessDefinition): SourceCursor {
  return definition.reader === "json-document"
    ? { kind: "document", entries: [], documentHash: null, watermark: 0 }
    : { kind: "jsonl", offset: 0 };
}
export function prefixCursor(
  start: SourceCursor,
  end: SourceCursor,
  selected: readonly IngestRecord[],
  remaining: readonly IngestRecord[],
): SourceCursor {
  if (start.kind === "jsonl" && end.kind === "jsonl")
    return { kind: "jsonl", offset: remaining[0]?.pos ?? end.offset };
  if (start.kind === "document" && end.kind === "document") {
    const entries = [...start.entries];
    for (const record of selected) {
      const entry = end.entries[record.pos];
      if (entry) entries[record.pos] = entry;
    }
    return { ...end, entries };
  }
  throw new Error("A pending batch cannot change reader types.");
}
function nativeKey(value: unknown, fields: readonly string[]): string | null {
  const parsed = z.record(z.string(), z.unknown()).safeParse(value);
  if (!parsed.success) return null;
  for (const field of fields) {
    const key = parsed.data[field];
    if (typeof key === "string" && key) return key;
    if (typeof key === "number" && Number.isSafeInteger(key))
      return String(key);
  }
  return null;
}
export function readSource(
  path: string,
  previous: SourceCursor,
  definition: HarnessDefinition,
  watermark: number,
): SourceRead {
  if (previous.kind === "document") {
    const content = readFileSync(path, "utf8");
    const documentHash = hash(content);
    const parsed = z
      .looseObject({ messages: z.array(z.json()) })
      .parse(JSON.parse(content) as unknown);
    const metadata = z
      .record(z.string(), z.json())
      .parse(
        Object.fromEntries(
          Object.entries(parsed).filter(([key]) => key !== "messages"),
        ),
      );
    const sourcePos =
      documentHash === previous.documentHash
        ? Math.max(watermark, previous.watermark)
        : Math.max(watermark, previous.watermark + 1, parsed.messages.length);
    const entries = [...previous.entries];
    const records: IngestRecord[] = [];
    let bytes = 0;
    for (const [pos, value] of parsed.messages.entries()) {
      const line = JSON.stringify(value);
      const digest = hash(line);
      const existing = previous.entries[pos];
      if (existing?.hash === digest) continue;
      const lineBytes = Buffer.byteLength(line);
      if (records.length && bytes + lineBytes > TARGET_BATCH) break;
      if (lineBytes > MAX_RECORD)
        throw new OversizedSourceRecord(path, pos, line);
      const version = existing ? existing.version + 1 : 0;
      const id = nativeKey(value, definition.recordKeyFields) ?? String(pos);
      records.push({
        pos,
        key: `${id}:${String(version)}:${digest}`,
        sourceVersion: version,
        line,
      });
      entries[pos] = { hash: digest, version };
      bytes += lineBytes;
    }
    return {
      records,
      cursor: { kind: "document", entries, documentHash, watermark: sourcePos },
      sourcePos,
      transcriptMetadata: {
        ...metadata,
        sourceRecordCount: parsed.messages.length,
      },
    };
  }
  const fd = openSync(path, "r");
  try {
    const size = fstatSync(fd).size;
    let offset = size < previous.offset ? 0 : previous.offset;
    let scan = offset;
    let fragments: Buffer[] = [];
    let fragmentBytes = 0;
    const records: IngestRecord[] = [];
    let bytes = 0;
    let complete = true;
    while (scan < size) {
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, size - scan));
      const length = readSync(fd, chunk, 0, chunk.length, scan);
      if (!length) break;
      scan += length;
      let from = 0;
      while (from < length) {
        const newline = chunk.indexOf(10, from);
        const to = newline < 0 || newline >= length ? length : newline;
        const part = chunk.subarray(from, to);
        fragments.push(part);
        fragmentBytes += part.length;
        if (fragmentBytes > MAX_RECORD) {
          if (records.length) {
            complete = false;
            break;
          }
          throw new OversizedSourceRecord(path, offset);
        }
        if (newline < 0 || newline >= length) break;
        const line = Buffer.concat(fragments, fragmentBytes)
          .toString("utf8")
          .replace(/\r$/, "");
        const lineBytes = Buffer.byteLength(line);
        if (records.length && bytes + lineBytes > TARGET_BATCH) {
          complete = false;
          break;
        }
        if (line.trim()) {
          let payload: unknown = null;
          try {
            payload = JSON.parse(line) as unknown;
          } catch {
            /* API quarantine preserves malformed source bytes. */
          }
          records.push({
            pos: offset,
            key: nativeKey(payload, definition.recordKeyFields),
            sourceVersion: 0,
            line,
          });
          bytes += lineBytes;
        }
        offset += fragmentBytes + 1;
        fragments = [];
        fragmentBytes = 0;
        from = newline + 1;
      }
      if (!complete) break;
    }
    return {
      records,
      cursor: { kind: "jsonl", offset },
      sourcePos: Math.max(watermark, size),
    };
  } finally {
    closeSync(fd);
  }
}

function writeAll(fd: number, bytes: Buffer): void {
  let offset = 0;
  while (offset < bytes.length) {
    const written = writeSync(fd, bytes, offset, bytes.length - offset);
    if (written === 0)
      throw new Error("The quarantine write made no progress.");
    offset += written;
  }
}
/** Preserve oversized source bytes locally before allowing a later 202 to skip them. */
export function quarantineOversized(
  error: OversizedSourceRecord,
  previous: SourceCursor,
  watermark: number,
  directory: string,
): SourceRead {
  secureDirectory(directory);
  const temporary = join(directory, `${randomUUID()}.partial`);
  const output = openSync(temporary, "wx", 0o600);
  let cursor: SourceCursor;
  try {
    if (previous.kind === "document") {
      if (error.documentLine === undefined)
        throw new Error("Missing document record bytes.");
      writeAll(output, Buffer.from(error.documentLine));
      const entries = [...previous.entries];
      entries[error.pos] = {
        hash: hash(error.documentLine),
        version: (entries[error.pos]?.version ?? -1) + 1,
      };
      cursor = { ...previous, entries, watermark };
    } else {
      const source = openSync(error.path, "r");
      let offset = error.pos;
      let finished = false;
      try {
        const chunk = Buffer.allocUnsafe(64 * 1024);
        for (;;) {
          const count = readSync(source, chunk, 0, chunk.length, offset);
          if (!count) break;
          const newline = chunk.subarray(0, count).indexOf(10);
          const bytes = newline < 0 ? count : newline + 1;
          writeAll(output, chunk.subarray(0, bytes));
          offset += bytes;
          if (newline >= 0) {
            finished = true;
            break;
          }
        }
      } finally {
        closeSync(source);
      }
      cursor = { kind: "jsonl", offset: finished ? offset : previous.offset };
    }
    fsyncSync(output);
  } finally {
    closeSync(output);
  }
  const file = `${temporary}.raw`;
  renameSync(temporary, file);
  writeAtomic(`${file}.metadata`, {
    source: error.path,
    pos: error.pos,
    reason: "RECORD_TOO_LARGE",
    cursor,
  });
  return { records: [], cursor, sourcePos: watermark };
}
