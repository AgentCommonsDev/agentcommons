import { describe, expect, it } from "vitest";
import {
  traceColumnDescriptions,
  traceEmbeddingViews,
  traceViewCatalog,
  traceViews,
} from "./sql.js";

describe("trace view catalog", () => {
  // @req R-SQL-05
  it("describes every canonical and embeddings view with a purpose and short column meanings", () => {
    const names = [...traceViews, ...traceEmbeddingViews];
    expect(Object.keys(traceViewCatalog).sort()).toEqual([...names].sort());
    for (const name of names) {
      const view = traceViewCatalog[name];
      expect(view.purpose).toMatch(/^[A-Z].*[^.\s]$/);
      expect(view.purpose.length).toBeLessThan(160);
      expect(Object.keys(view.columns).length).toBeGreaterThan(0);
      for (const [column, meaning] of Object.entries(view.columns)) {
        expect(column).toMatch(/^[a-z][a-z0-9_]*$/);
        expect(meaning).toMatch(/^[A-Za-z0-9].*[^.\s]$/);
        expect(meaning).not.toMatch(/\n/);
        expect(meaning.length).toBeLessThan(120);
      }
    }
  });

  // @req R-SQL-05
  it("flattens to unique view.column keys in catalog order", () => {
    const rows = traceColumnDescriptions();
    const keys = rows.map((row) => `${row.view}.${row.column}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys[0]).toBe("sessions.session_id");
    expect(rows.every((row) => row.description.length > 0)).toBe(true);
  });
});
