import Papa from "papaparse";
import { z } from "zod";
const recordSchema = z.record(z.string(), z.unknown());
export function formatCsvTable(
  fields: readonly string[],
  rows: readonly (readonly unknown[])[],
  options: { header?: boolean } = {},
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
    { header: options.header ?? true, escapeFormulae: true, newline: "\r\n" },
  );
}
/**
 * The same table as `formatCsvTable`, one chunk per line as the rows arrive: the header
 * first, then each row in the shared dialect, so a whole-record export streams without
 * holding every row in memory. Joined, the chunks equal the table of the same rows.
 */
export async function* formatCsvLines(
  fields: readonly string[],
  rows: AsyncIterable<Record<string, unknown>>,
): AsyncGenerator<string> {
  yield formatCsvTable(fields, []);
  let count = 0;
  for await (const row of rows)
    yield `${count++ ? "\r\n" : ""}${formatCsvTable(
      fields,
      [fields.map((field) => row[field])],
      { header: false },
    )}`;
}
export function formatCsv(rows: readonly unknown[]): string {
  const records = rows.map((row) => recordSchema.parse(row));
  const fields = Object.keys(records[0] ?? {});
  return formatCsvTable(
    fields,
    records.map((row) => fields.map((field) => row[field])),
  );
}
