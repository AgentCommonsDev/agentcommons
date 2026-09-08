import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const directories: string[] = [];
const marker = "@" + "req";

function fixture(requirements: string, tests = "") {
  const root = mkdtempSync(join(tmpdir(), "agentcommons spec "));
  directories.push(root);
  for (const directory of ["docs", "scripts", "packages/core"])
    mkdirSync(join(root, directory), { recursive: true });
  copyFileSync(
    new URL("../../scripts/spec-check.mjs", import.meta.url),
    join(root, "scripts/spec-check.mjs"),
  );
  writeFileSync(
    join(root, "docs/SPEC.md"),
    "## 7. Search\n### 7.2 Search ranking\n## Appendix A. Captures\n",
  );
  writeFileSync(join(root, "docs/REQUIREMENTS.md"), requirements);
  writeFileSync(join(root, "packages/core/ranking.test.ts"), tests);
  return join(root, "scripts/spec-check.mjs");
}

afterEach(() => {
  for (const root of directories.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("requirement traceability checker", () => {
  it("handles inline pipes and workspace paths containing spaces", () => {
    const script = fixture(
      "| R-TEST-01 | Rank with `1\\|32` | §7.2 | integration |",
      `// ${marker} R-TEST-01`,
    );
    const output = execFileSync(process.execPath, [script], {
      encoding: "utf8",
    });
    expect(output).toContain("1 requirements, 1 covered, 0 uncovered");
    expect(output).toMatch(/R-TEST-01\s+1\s+§7.2/);
  });

  it.each(["§99.1", "missing reference"])(
    "rejects invalid spec references: %s",
    (section) => {
      const script = fixture(
        `| R-TEST-01 | Search | ${section} | unit |`,
        `// ${marker} R-TEST-01`,
      );
      const result = spawnSync(process.execPath, [script], {
        encoding: "utf8",
      });
      expect(result.status).toBe(1);
      expect(result.stdout).toContain(
        "requirements citing missing spec sections",
      );
    },
  );

  it("reports missing coverage without treating report mode as completion", () => {
    const script = fixture("| R-TEST-01 | Search | §7.2 | unit |");
    const failed = spawnSync(process.execPath, [script], { encoding: "utf8" });
    const report = spawnSync(process.execPath, [script, "--report"], {
      encoding: "utf8",
    });
    expect(failed.status).toBe(1);
    expect(report.status).toBe(0);
    expect(report.stdout).toContain("1 uncovered");
  });

  it("rejects unknown citations and duplicate requirement IDs", () => {
    const script = fixture(
      "| R-TEST-01 | Search | §7.2 | unit |\n| R-TEST-01 | Search again | Appendix A | integration |",
      `// ${marker} R-TEST-02`,
    );
    const result = spawnSync(process.execPath, [script], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("duplicate IDs: R-TEST-01");
    expect(result.stdout).toContain("tests citing unknown IDs: R-TEST-02");
  });
});
