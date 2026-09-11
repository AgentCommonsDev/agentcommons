import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile, chmod, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import {
  agentInstructions,
  agentInstructionsFor,
  blockText,
  formatInstallCommand,
  guidanceBlock,
  guidanceMarkers,
  markedBlock,
  repositoryInstructions,
} from "./install.js";

describe("installation command", () => {
  // @req R-DASH-23 @req R-ARCH-02
  it("passes a key as one literal argument through a real POSIX shell", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agentcommons-command-"));
    try {
      const curl = join(directory, "curl");
      await writeFile(
        curl,
        "#!/bin/sh\nprintf '%s\\n' 'printf \"%s\" \"$2\"'\n",
      );
      await chmod(curl, 0o700);
      const key = "fixture' $HOME $(printf injected)\nsecond line";
      const command = formatInstallCommand("https://example.test/base", key);
      expect(command).toContain("'https://example.test/install.sh'");
      const output = execFileSync("sh", ["-c", command], {
        env: { ...process.env, PATH: `${directory}:${process.env.PATH ?? ""}` },
        encoding: "utf8",
      });
      expect(output).toBe(key);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("agent guidance", () => {
  // @req R-INST-07
  it("frames one search-first text for a machine and for a repository inside the same markers", () => {
    const shared =
      "Before you\nchange code, search it for the test, file or error you were given: an earlier session";
    expect(agentInstructions).toContain(shared);
    expect(agentInstructionsFor("machine")).toBe(agentInstructions);
    // A blank line after the heading, as prettier prints a heading followed by a paragraph.
    expect(
      repositoryInstructions.startsWith(
        "## AgentCommons\n\nPast agent sessions on this repository",
      ),
    ).toBe(true);
    expect(agentInstructions.startsWith("## AgentCommons\n\nPast")).toBe(true);
    expect(repositoryInstructions.replaceAll("\n", " ")).toContain(
      shared.replaceAll("\n", " "),
    );
    expect(repositoryInstructions).toContain(
      "If this machine has no `agentcommons` MCP server",
    );
    for (const line of repositoryInstructions.split("\n"))
      expect(line.length).toBeLessThanOrEqual(88);
    // The block layout prettier's markdown printer keeps: a blank line after the begin
    // marker, no trailing whitespace, the end marker right after the last line of text.
    const block = guidanceBlock(repositoryInstructions);
    expect(block).toBe(
      `${guidanceMarkers.begin}\n\n${repositoryInstructions}\n${guidanceMarkers.end}`,
    );
    expect(markedBlock(guidanceMarkers, "\n\n## Title  \n\nText \t\n\n")).toBe(
      `${guidanceMarkers.begin}\n\n## Title\n\nText\n${guidanceMarkers.end}`,
    );
    expect(guidanceMarkers).toEqual({
      begin: "<!-- agentcommons-hook begin -->",
      end: "<!-- agentcommons-hook end -->",
    });
  });

  // @req R-CAP-25
  it("compares what a block says, not how a formatter laid it out", () => {
    expect(blockText("## AgentCommons\n\nText.\n")).toBe(
      "## AgentCommons\nText.",
    );
    expect(blockText("\n\n## AgentCommons  \n\n\nText.  \n\n")).toBe(
      blockText(repositoryInstructions.slice(0, 15) + "\nText."),
    );
    expect(blockText(agentInstructions)).not.toBe(
      blockText(repositoryInstructions),
    );
    expect(blockText("## AgentCommons\nText.")).not.toBe(
      blockText("## AgentCommons\nText"),
    );
  });
});
