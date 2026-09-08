import { describe, expect, it } from "vitest";
import Papa from "papaparse";
import { formatCsv, formatCsvTable } from "./csv.js";

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
});
