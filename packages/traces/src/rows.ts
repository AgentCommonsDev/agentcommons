import { z } from "zod";
import { traceTables, type TraceTable } from "./schema.js";
export function traceWire(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(traceWire);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, traceWire(item)]),
    );
  return value;
}
function columnSchema(type: string): z.ZodType {
  if (type.startsWith("Nullable("))
    return columnSchema(type.slice(9, -1)).nullable();
  if (type.startsWith("Array("))
    return z.array(columnSchema(type.slice(6, -1)));
  if (type === "UUID") return z.uuid();
  if (type === "Bool") return z.boolean();
  if (type.startsWith("DateTime64")) return z.iso.datetime();
  if (type === "Int64") return z.string().regex(/^-?\d+$/);
  if (type === "UInt32" || type === "UInt16" || type === "UInt8")
    return z.number().int().nonnegative();
  if (type === "Int32") return z.number().int();
  if (type === "Float32") return z.number();
  return z.string();
}
export function validateTraceRow(
  table: TraceTable,
  row: unknown,
): Record<string, unknown> {
  const shape = Object.fromEntries(
    Object.entries(traceTables[table].columns).map(([key, type]) => [
      key,
      columnSchema(type),
    ]),
  );
  return z
    .strictObject({
      ...shape,
      revision: z.string().regex(/^\d+$/),
      generation: z.string().regex(/^\d+$/),
      deleted: z.number().int().min(0).max(1),
      fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .parse(traceWire(row));
}
export function emptyTraceRow(table: TraceTable): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(traceTables[table].columns).map(([name, type]) => [
      name,
      type.startsWith("Nullable")
        ? null
        : type.startsWith("Array")
          ? []
          : type === "Bool"
            ? false
            : type === "UUID"
              ? "00000000-0000-0000-0000-000000000000"
              : type.startsWith("DateTime64")
                ? "1970-01-01T00:00:00.000Z"
                : type === "Int64"
                  ? "0"
                  : type.startsWith("UInt")
                    ? 0
                    : "",
    ]),
  );
}
