import {
  jsonByteLength,
  jsonValueSchema,
  responseBytes,
  truncateUtf8,
  type JsonValue,
} from "@agentcommons/core";
import type { Formatted } from "@agentcommons/core/format";
import { z } from "zod";
import { ServiceError } from "./context.js";
import type { CursorCodec } from "./cursor.js";

/** Longest metadata string a list or header carries before it is cut with an ellipsis. */
const METADATA_FIELD_BYTES = 256;
export function compactMetadata(
  value: Record<string, unknown>,
  fields: readonly string[],
): Record<string, unknown> & { truncated_fields: string[] } {
  const result: Record<string, unknown> & { truncated_fields: string[] } = {
    ...value,
    truncated_fields: [],
  };
  for (const field of fields) {
    const text = value[field];
    if (
      typeof text !== "string" ||
      Buffer.byteLength(text) <= METADATA_FIELD_BYTES
    )
      continue;
    result[field] = `${truncateUtf8(text, METADATA_FIELD_BYTES - 3)}…`;
    result.truncated_fields.push(field);
  }
  result.truncated_fields.sort();
  return result;
}
export function wireValue(value: unknown): JsonValue {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(wireValue);
  if (value !== null && typeof value === "object") return wireRow(value);
  return jsonValueSchema.parse(value);
}
export function wireRow(value: object): Record<string, JsonValue> {
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .map(([key, child]) => [key, wireValue(child)]),
  );
}
/** The wire row's values for the keys one object schema declares, and nothing else. */
export function pickSchema(
  row: Record<string, JsonValue>,
  schema: z.ZodObject,
): Record<string, JsonValue> {
  const picked: Record<string, JsonValue> = {};
  for (const key of Object.keys(schema.shape)) {
    const value = row[key];
    if (value !== undefined) picked[key] = value;
  }
  return picked;
}
/** Whether one search or get result fits the tool budget in both its JSON and text forms. */
export function fitsToolBudget<T>(
  output: T,
  format: (value: T) => Formatted<T>,
): boolean {
  return (
    jsonByteLength(output) <= responseBytes.read &&
    Buffer.byteLength(format(output).text) <= responseBytes.read
  );
}

export function boundedPage<T>(
  items: T[],
  hasMore: boolean,
  cursorAfter: (last: T, count: number) => string,
) {
  const page = { items, cursor: null as string | null };
  while (items.length) {
    const last = items.at(-1);
    page.cursor =
      hasMore && last !== undefined ? cursorAfter(last, items.length) : null;
    if (jsonByteLength(page) <= responseBytes.page) return page;
    items.pop();
    hasMore = true;
  }
  if (hasMore)
    throw new ServiceError(
      413,
      "RECORD_TOO_LARGE",
      "This record exceeds the response limit. Use SQL to select the fields you need.",
    );
  return page;
}

const offsetPositionSchema = z.number().int().nonnegative();

/**
 * Offset pagination behind an opaque, binding-signed cursor: decodes the offset, fetches one row
 * past `limit` to learn whether a next page exists, trims the page to the response budget and
 * encodes the offset of the first row not returned. `fetch` returns the output items themselves,
 * since the budget is measured on what the caller sends.
 */
export async function offsetPage<T>(
  cursors: CursorCodec,
  binding: JsonValue,
  cursor: string | null | undefined,
  limit: number,
  fetch: (offset: number, take: number) => Promise<readonly T[]>,
): Promise<{ items: T[]; cursor: string | null }> {
  const offset = cursor
    ? cursors.decode(cursor, binding, offsetPositionSchema)
    : 0;
  const rows = await fetch(offset, limit + 1);
  return boundedPage(
    rows.slice(0, limit),
    rows.length > limit,
    (_last, count) => cursors.encode(binding, offset + count),
  );
}
