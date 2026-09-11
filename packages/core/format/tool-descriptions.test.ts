import { describe, expect, it } from "vitest";
import { searchInputSchema } from "../schemas/search.js";
import {
  governingSentence,
  serverInstructions,
  toolDescriptions,
  toolExampleSchemas,
  toolExamples,
} from "./tool-descriptions.js";

describe("read tool descriptions", () => {
  // @req R-MCP-04 @req R-MCP-12
  it("are action-first, keep the governing guidance, and end with a worked example the call schema accepts", () => {
    for (const name of ["search", "get", "sql"] as const) {
      const text = toolDescriptions[name];
      // The example in the text is the example the schema parses: the catalog cannot drift from the contract.
      const example = JSON.stringify(toolExamples[name]);
      expect(text.endsWith(`${example}.`), name).toBe(true);
      expect(
        toolExampleSchemas[name].safeParse(toolExamples[name]).success,
        name,
      ).toBe(true);
      // Descriptions never claim the old gate; the governing sentence is prepended by the catalog.
      expect(text).not.toMatch(/only (use|when)/i);
      expect(text).not.toContain(governingSentence);
    }
    // The strict search schema accepts the advertised example as well.
    expect(searchInputSchema.safeParse(toolExamples.search).success).toBe(true);
    // search is the first call for the questions the product exists for.
    expect(toolDescriptions.search).toMatch(/^Find the earlier sessions/);
    for (const phrase of [
      "has anyone",
      "why does",
      "how did we",
      "2 to 4 specific words",
      "every word must appear",
    ])
      expect(toolDescriptions.search).toContain(phrase);
    expect(toolDescriptions.get).toMatch(/^Open one session by session_id/);
    expect(toolDescriptions.sql).toMatch(/^Answer questions search cannot/);
    expect(governingSentence).toBe(
      "Use this to check prior work before changing code, and whenever the user asks about earlier sessions; run long investigations in a subagent that returns only findings with session ids.",
    );
    expect(serverInstructions).toContain(
      "Before changing code, search for the test, file path or error you were given",
    );
  });

  // @req R-MCP-09 @req R-MCP-12
  it("stay inside the per-tool share of the catalog budget", () => {
    // The default catalog (three tools) stays under 12 KB (ADR 0068); the descriptions are
    // the part that grows with guidance, so each is bounded to 1,200 bytes with the
    // governing sentence (measured 2026-09-11: search 1,086, get 871, sql 1,160 bytes).
    for (const name of ["search", "get", "sql"] as const) {
      const bytes = Buffer.byteLength(
        `${governingSentence} ${toolDescriptions[name]}`,
      );
      expect(bytes, `${name}: ${String(bytes)} bytes`).toBeLessThan(1200);
    }
  });
});
