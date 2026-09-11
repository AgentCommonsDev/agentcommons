import { execFileSync } from "node:child_process";
import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  guidanceBlock,
  guidanceMarkers,
  repositoryInstructions,
} from "@agentcommons/core/format/install";
import { describe, expect, it } from "vitest";
import { HARNESSES } from "../src/harnesses.js";
import {
  primaryRepositoryInstructionsFile,
  writeRepositoryGuidance,
} from "../src/install.js";

describe("repository guidance", () => {
  // @req R-INST-07
  it("writes the marked block into AGENTS.md, links the other harness files to it, and keeps user text", () => {
    const root = mkdtempSync(join(tmpdir(), "agentcommons-guidance-"));
    expect(primaryRepositoryInstructionsFile()).toBe("AGENTS.md");
    writeFileSync(join(root, "AGENTS.md"), "# Project\n\nUser rules.\n");
    writeFileSync(join(root, "CLAUDE.md"), "Claude only rules.\n");
    const first = writeRepositoryGuidance(root);
    expect(first).toEqual({
      written: [join(root, "AGENTS.md"), join(root, "CLAUDE.md")],
      linked: [join(root, "GEMINI.md")],
    });
    expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toBe(
      `# Project\n\nUser rules.\n\n${guidanceBlock(repositoryInstructions)}\n`,
    );
    expect(readFileSync(join(root, "CLAUDE.md"), "utf8")).toBe(
      `Claude only rules.\n\n${guidanceBlock(repositoryInstructions)}\n`,
    );
    expect(lstatSync(join(root, "GEMINI.md")).isSymbolicLink()).toBe(true);
    expect(readlinkSync(join(root, "GEMINI.md"))).toBe("AGENTS.md");
    // Every supported harness now finds the block under the file it reads.
    for (const definition of Object.values(HARNESSES))
      expect(
        readFileSync(join(root, definition.repositoryInstructionsFile), "utf8"),
      ).toContain(guidanceMarkers.begin);
    // Idempotent: a second run changes nothing and a stale block is replaced in place.
    writeFileSync(
      join(root, "AGENTS.md"),
      `# Project\n\n${guidanceMarkers.begin}\nold text\n${guidanceMarkers.end}\n\nAfter.\n`,
    );
    expect(writeRepositoryGuidance(root).linked).toEqual([]);
    expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toBe(
      `# Project\n\nAfter.\n\n${guidanceBlock(repositoryInstructions)}\n`,
    );
    expect(
      readFileSync(join(root, "AGENTS.md"), "utf8").split(
        guidanceMarkers.begin,
      ),
    ).toHaveLength(2);
  });

  // @req R-INST-07
  it("leaves a symlink that points elsewhere alone and is reachable as `hook.js guidance --repo`", () => {
    const root = mkdtempSync(join(tmpdir(), "agentcommons-guidance-cli-"));
    writeFileSync(join(root, "docs.md"), "elsewhere\n");
    symlinkSync("docs.md", join(root, "CLAUDE.md"));
    const output = execFileSync(
      process.execPath,
      [resolve("packages/hook/dist/hook.js"), "guidance", "--repo", root],
      {
        env: {
          ...process.env,
          AGENTCOMMONS_DIR: mkdtempSync(
            join(tmpdir(), "agentcommons-guidance-dir-"),
          ),
        },
        encoding: "utf8",
      },
    );
    expect(output).toBe(
      `Wrote the AgentCommons guidance to ${join(root, "AGENTS.md")} and linked ${join(root, "GEMINI.md")} to it.\nCommit these files so every teammate's agent reads the guidance.\n`,
    );
    expect(readlinkSync(join(root, "CLAUDE.md"))).toBe("docs.md");
    expect(readFileSync(join(root, "docs.md"), "utf8")).toBe("elsewhere\n");
    expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toBe(
      `${guidanceBlock(repositoryInstructions)}\n`,
    );
  });
});
