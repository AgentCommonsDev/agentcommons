import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import {
  appendixMarker,
  readMcpFixture,
  renderAppendix,
} from "./mcp-fixtures.js";

// @req R-MCP-06
it("keeps Appendix C generated from the real SDK contract-test fixture", async () => {
  const spec = await readFile(
    new URL("../../../docs/SPEC.md", import.meta.url),
    "utf8",
  );
  expect(spec.slice(spec.indexOf(appendixMarker))).toBe(
    await renderAppendix(await readMcpFixture()),
  );
});
