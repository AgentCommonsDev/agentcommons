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
/** Wire validator and empty default per scalar ClickHouse type; Nullable and Array wrap these. */
const columnKinds: ReadonlyArray<{
  matches: (type: string) => boolean;
  schema: z.ZodType;
  empty: unknown;
}> = [
  {
    matches: (type) => type === "UUID",
    schema: z.uuid(),
    empty: "00000000-0000-0000-0000-000000000000",
  },
  { matches: (type) => type === "Bool", schema: z.boolean(), empty: false },
  {
    matches: (type) => type.startsWith("DateTime64"),
    schema: z.iso.datetime(),
    empty: "1970-01-01T00:00:00.000Z",
  },
  {
    matches: (type) => type === "Int64",
    schema: z.string().regex(/^-?\d+$/),
    empty: "0",
  },
  {
    matches: (type) => type.startsWith("UInt"),
    schema: z.number().int().nonnegative(),
    empty: 0,
  },
  { matches: (type) => type === "Int32", schema: z.number().int(), empty: 0 },
  { matches: (type) => type === "Float32", schema: z.number(), empty: 0 },
];
const textKind = { schema: z.string(), empty: "" };
function columnKind(type: string) {
  return columnKinds.find((kind) => kind.matches(type)) ?? textKind;
}
function columnSchema(type: string): z.ZodType {
  if (type.startsWith("Nullable("))
    return columnSchema(type.slice(9, -1)).nullable();
  if (type.startsWith("Array("))
    return z.array(columnSchema(type.slice(6, -1)));
  return columnKind(type).schema;
}
function emptyColumn(type: string): unknown {
  if (type.startsWith("Nullable(")) return null;
  if (type.startsWith("Array(")) return [];
  return columnKind(type).empty;
}
function buildRowSchema(table: TraceTable) {
  return z.strictObject({
    ...Object.fromEntries(
      Object.entries(traceTables[table].columns).map(([name, type]) => [
        name,
        columnSchema(type),
      ]),
    ),
    revision: z.string().regex(/^\d+$/),
    generation: z.string().regex(/^\d+$/),
    deleted: z.number().int().min(0).max(1),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  });
}
/** Built once per table: projections validate thousands of rows per publication. */
const rowSchemas = new Map<TraceTable, ReturnType<typeof buildRowSchema>>();
function rowSchema(table: TraceTable) {
  const existing = rowSchemas.get(table);
  if (existing) return existing;
  const schema = buildRowSchema(table);
  rowSchemas.set(table, schema);
  return schema;
}
export function validateTraceRow(
  table: TraceTable,
  row: unknown,
): Record<string, unknown> {
  return rowSchema(table).parse(traceWire(row));
}
export function emptyTraceRow(table: TraceTable): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(traceTables[table].columns).map(([name, type]) => [
      name,
      emptyColumn(type),
    ]),
  );
}
