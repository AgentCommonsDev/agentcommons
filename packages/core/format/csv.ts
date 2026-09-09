import Papa from "papaparse";
import { z } from "zod";
const recordSchema = z.record(z.string(), z.unknown());
export function formatCsvTable(
  fields: readonly string[],
  rows: readonly (readonly unknown[])[],
): string {
  return Papa.unparse(
    {
      fields: [...fields],
      data: rows.map((row) =>
        row.map((value) =>
          value !== null && typeof value === "object"
            ? JSON.stringify(value)
            : value,
        ),
      ),
    },
    { escapeFormulae: true, newline: "\r\n" },
  );
}
export function formatCsv(rows: readonly unknown[]): string {
  const records = rows.map((row) => recordSchema.parse(row));
  const fields = Object.keys(records[0] ?? {});
  return formatCsvTable(
    fields,
    records.map((row) => fields.map((field) => row[field])),
  );
}
