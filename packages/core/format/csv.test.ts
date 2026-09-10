import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import Papa from "papaparse";
import { formatCsv, formatCsvLines, formatCsvTable } from "./csv.js";

async function joined(
  fields: readonly string[],
  rows: readonly Record<string, unknown>[],
): Promise<string> {
  const chunks: string[] = [];
  for await (const chunk of formatCsvLines(fields, Readable.from(rows)))
    chunks.push(chunk);
  return chunks.join("");
}

describe("shared CSV export", () => {
  // @req R-ARCH-02 @req R-DASH-05
  it("preserves duplicate SQL labels, raw nulls, JSON, and multiline content", () => {
    const json = { paths: ["one,two", "line\nthree"] };
    const fields = ["same", "same", "empty", "json", "text"];
    const csv = formatCsvTable(fields, [[null, 12, "", json, "a,b\nnext"]]);
    const parsed = Papa.parse<string[]>(csv);
    expect(parsed.errors).toEqual([]);
    expect(parsed.data).toEqual([
      fields,
      ["", "12", "", JSON.stringify(json), "a,b\nnext"],
    ]);
    expect(formatCsvTable(["same", "same"], [])).toBe("same,same\r\n");
  });

  // @req R-ARCH-02 @req R-DASH-05
  it("uses identical formula escaping for record and table exports", () => {
    const fields = ["equals", "plus", "minus", "at", "tab", "number", "null"];
    const row = ["=1+1", "+1+1", "-1+1", "@SUM(1,2)", "\t=1+1", 42, null];
    const record = Object.fromEntries(
      fields.map((field, index) => [field, row[index]]),
    );
    const table = formatCsvTable(fields, [row]);
    expect(formatCsv([record])).toBe(table);
    expect(Papa.parse<string[]>(table).data[1]).toEqual([
      "'=1+1",
      "'+1+1",
      "'-1+1",
      "'@SUM(1,2)",
      "'\t=1+1",
      "42",
      "",
    ]);
    expect(formatCsv([])).toBe("");
    expect(
      Papa.parse<string[]>(formatCsvTable(["=1+1"], [[-42]])).data,
    ).toEqual([["'=1+1"], ["-42"]]);
  });

  // @req R-DASH-38 @req R-ARCH-02
  it("streams a row iterator line by line into the same table as the record export", async () => {
    const fields = ["seq", "content", "truncated_fields", "model"];
    const rows = [
      { seq: 0, content: "=SUM(A1), next", truncated_fields: [] },
      { seq: 1, content: "", truncated_fields: ["model"], model: null },
      { seq: 2, content: '"quoted"\nline', truncated_fields: [], model: "m" },
    ];
    const streamed = await joined(fields, rows);
    expect(streamed).toBe(
      formatCsvTable(
        fields,
        rows.map((row) =>
          fields.map((field) => row[field as keyof typeof row]),
        ),
      ),
    );
    expect(Papa.parse<string[]>(streamed).data).toEqual([
      fields,
      ["0", "'=SUM(A1), next", "[]", ""],
      ["1", "", '["model"]', ""],
      ["2", '"quoted"\nline', "[]", "m"],
    ]);
    // An empty export still names its columns.
    expect(await joined(fields, [])).toBe(formatCsvTable(fields, []));
    expect(await joined(fields, [])).toBe(`${fields.join(",")}\r\n`);
  });
});
