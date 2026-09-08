import {
  jsonValueSchema,
  truncateUtf8,
  type JsonValue,
} from "@agentcommons/core";
import { ServiceError } from "./context.js";

export function bytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value));
}
export function compactMetadata(
  value: Record<string, unknown>,
  fields: readonly string[],
  maximumBytes = 256,
): Record<string, unknown> & { truncated_fields: string[] } {
  const result: Record<string, unknown> & { truncated_fields: string[] } = {
    ...value,
    truncated_fields: [],
  };
  for (const field of fields) {
    const text = value[field];
    if (typeof text !== "string" || Buffer.byteLength(text) <= maximumBytes)
      continue;
    result[field] = `${truncateUtf8(text, maximumBytes - 3)}…`;
    result.truncated_fields.push(field);
  }
  result.truncated_fields.sort();
  return result;
}
export function wireValue(value: unknown): JsonValue {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(wireValue);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, child]) => child !== undefined)
        .map(([key, child]) => [key, wireValue(child)]),
    );
  return jsonValueSchema.parse(value);
}
export function wireRow(
  value: Record<string, unknown>,
): Record<string, JsonValue> {
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .map(([key, child]) => [key, wireValue(child)]),
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
    if (bytes(page) <= 256 * 1024) return page;
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
