import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

// @req R-INF-06
it("the complete repository has no uncovered, unknown, or invalid requirement citations", () => {
  const output = execFileSync(
    process.execPath,
    [fileURLToPath(new URL("../scripts/spec-check.mjs", import.meta.url))],
    { encoding: "utf8" },
  );
  expect(output).toMatch(/\d+ requirements, \d+ covered, 0 uncovered/);
});
