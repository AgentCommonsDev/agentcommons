import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
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
// Test-only: the root's prettier checks the layout the zero-dependency shim writes.
import { format } from "prettier";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hash, writeAtomic } from "../src/files.js";
import {
  primaryRepositoryInstructionsFile,
  removeRepositoryGuidance,
  writeRepositoryGuidance,
} from "../src/guidance.js";
import { HARNESSES } from "../src/harnesses.js";
import {
  hookContextOutput,
  promptHint,
  recallCachePath,
  recallHintText,
} from "../src/recall.js";
import { upload } from "../src/upload.js";
import { SHIM, fixture, wiredConfigHome } from "./fixture.js";

const executable = resolve("packages/hook/dist/hook.js");
const REMOTE = "git@github.com:acme/widgets.git";
const REPO = "github.com/acme/widgets";
const BLOCK = `${guidanceBlock(repositoryInstructions)}\n`;
const NOW = new Date("2026-09-11T12:00:00Z");
const FILES = ["AGENTS.md", "CLAUDE.md", "GEMINI.md"];
/** A fresh working tree, with `origin` set unless `remote` is null. */
function checkout(remote: string | null = REMOTE, parent = tmpdir()): string {
  const root = mkdtempSync(join(parent, "agentcommons-checkout-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  if (remote)
    execFileSync("git", ["remote", "add", "origin", remote], { cwd: root });
  return root;
}
const read = (path: string) => readFileSync(path, "utf8");
const linkTarget = (path: string) =>
  lstatSync(path).isSymbolicLink() ? readlinkSync(path) : null;
const wired = () =>
  wiredConfigHome(mkdtempSync(join(tmpdir(), "agentcommons-guidance-home-")));
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("repository guidance command", () => {
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
      changed: [join(root, "AGENTS.md"), join(root, "CLAUDE.md")],
      skipped: [],
    });
    expect(read(join(root, "AGENTS.md"))).toBe(
      `# Project\n\nUser rules.\n\n${BLOCK}`,
    );
    expect(read(join(root, "CLAUDE.md"))).toBe(
      `Claude only rules.\n\n${BLOCK}`,
    );
    expect(linkTarget(join(root, "GEMINI.md"))).toBe("AGENTS.md");
    // Every supported harness now finds the block under the file it reads.
    for (const definition of Object.values(HARNESSES))
      expect(read(join(root, definition.repositoryInstructionsFile))).toContain(
        guidanceMarkers.begin,
      );
    // Idempotent: a second run changes nothing and a stale block is replaced in place.
    expect(writeRepositoryGuidance(root).changed).toEqual([]);
    writeFileSync(
      join(root, "AGENTS.md"),
      `# Project\n\n${guidanceMarkers.begin}\nold text\n${guidanceMarkers.end}\n\nAfter.\n`,
    );
    const refreshed = writeRepositoryGuidance(root);
    expect(refreshed.linked).toEqual([]);
    expect(refreshed.changed).toEqual([join(root, "AGENTS.md")]);
    expect(read(join(root, "AGENTS.md"))).toBe(
      `# Project\n\nAfter.\n\n${BLOCK}`,
    );
    expect(
      read(join(root, "AGENTS.md")).split(guidanceMarkers.begin),
    ).toHaveLength(2);
  });

  // @req R-INST-07
  it("leaves a symlink that points elsewhere alone and is reachable as `hook.js guidance --repo`", () => {
    const root = mkdtempSync(join(tmpdir(), "agentcommons-guidance-cli-"));
    const directory = mkdtempSync(join(tmpdir(), "agentcommons-guidance-dir-"));
    writeFileSync(join(root, "docs.md"), "elsewhere\n");
    symlinkSync("docs.md", join(root, "CLAUDE.md"));
    const output = execFileSync(
      process.execPath,
      [executable, "guidance", "--repo", root],
      {
        env: { ...process.env, AGENTCOMMONS_DIR: directory },
        encoding: "utf8",
      },
    );
    expect(output).toBe(
      `Wrote the AgentCommons guidance to ${join(root, "AGENTS.md")} and linked ${join(root, "GEMINI.md")} to it.\nLeft ${join(root, "CLAUDE.md")} alone: not a regular file inside the repository.\n`,
    );
    expect(readlinkSync(join(root, "CLAUDE.md"))).toBe("docs.md");
    expect(read(join(root, "docs.md"))).toBe("elsewhere\n");
    expect(read(join(root, "AGENTS.md"))).toBe(BLOCK);
    expect(existsSync(join(directory, "guidance"))).toBe(false);
  });

  // @req R-INST-08
  it("`--off` removes the block and its dangling links, preserves user text, and can be explicitly reversed", () => {
    const root = checkout();
    const directory = mkdtempSync(join(tmpdir(), "agentcommons-guidance-off-"));
    const env = { ...process.env, AGENTCOMMONS_DIR: directory };
    writeFileSync(join(root, "CLAUDE.md"), "Claude only rules.\n");
    execFileSync(process.execPath, [executable, "guidance", "--repo", root], {
      env,
    });
    expect(read(join(root, "AGENTS.md"))).toBe(BLOCK);
    expect(read(join(root, "CLAUDE.md"))).toBe(
      `Claude only rules.\n\n${BLOCK}`,
    );
    expect(linkTarget(join(root, "GEMINI.md"))).toBe("AGENTS.md");
    const off = execFileSync(
      process.execPath,
      [executable, "guidance", "--repo", root, "--off"],
      { env, encoding: "utf8" },
    );
    expect(off).toBe(
      `Removed the AgentCommons guidance from ${join(root, "AGENTS.md")}, ${join(root, "CLAUDE.md")}, ${join(root, "GEMINI.md")}.\nRun the command without --off to add it again.\n`,
    );
    // AGENTS.md held only the block, so it is gone with the link that pointed at it; user text stays.
    expect(existsSync(join(root, "AGENTS.md"))).toBe(false);
    expect(
      lstatSync(join(root, "GEMINI.md"), { throwIfNoEntry: false }),
    ).toBeUndefined();
    expect(read(join(root, "CLAUDE.md"))).toBe("Claude only rules.\n");
    expect(existsSync(join(directory, "guidance"))).toBe(false);
    // Running `--off` again is harmless.
    expect(
      execFileSync(
        process.execPath,
        [executable, "guidance", "--repo", root, "--off"],
        {
          env,
          encoding: "utf8",
        },
      ),
    ).toContain("No AgentCommons guidance to remove.");
    // The plain command explicitly writes again.
    execFileSync(process.execPath, [executable, "guidance", "--repo", root], {
      env,
    });
    expect(read(join(root, "AGENTS.md"))).toBe(BLOCK);
    expect(existsSync(join(directory, "guidance"))).toBe(false);
  });
});

describe("capture leaves repository guidance alone", () => {
  // @req R-CAP-25
  it.each([false, true])(
    "never writes repository files with legacy settings enabled: %s",
    async (legacy) => {
      const f = fixture({
        config: { ...wired(), ...(legacy ? { guidance: { auto: true } } : {}) },
      });
      if (legacy) vi.stubEnv("AGENTCOMMONS_GUIDANCE_AUTO", "1");
      const root = checkout();
      const nested = join(root, "src");
      mkdirSync(nested);
      const options = {
        fetch: f.fetcher,
        sleep: () => Promise.resolve(),
        update: false,
        recall: false,
        policy: false,
      };
      const path = f.hook({ cwd: nested, hook_event_name: "SessionStart" });
      await upload(f.directory, SHIM, path, f.config, options);
      expect(f.received.length).toBeGreaterThan(0);
      for (const name of FILES)
        expect(existsSync(join(root, name))).toBe(false);
      expect(existsSync(join(f.directory, "guidance"))).toBe(false);
      expect(
        execFileSync("git", ["status", "--porcelain"], {
          cwd: root,
          encoding: "utf8",
        }),
      ).toBe("");

      // An old block and existing links remain byte-for-byte unchanged on later sessions.
      const original =
        "# Project\n\n" +
        guidanceMarkers.begin +
        "\nOlder instructions.\n" +
        guidanceMarkers.end +
        "\n";
      writeFileSync(join(root, "AGENTS.md"), original);
      symlinkSync("AGENTS.md", join(root, "CLAUDE.md"));
      const status = execFileSync("git", ["status", "--porcelain"], {
        cwd: root,
        encoding: "utf8",
      });
      const secondPath = f.hook({
        cwd: root,
        session_id: randomUUID(),
        hook_event_name: "SessionStart",
      });
      await upload(f.directory, SHIM, secondPath, f.config, options);
      expect(read(join(root, "AGENTS.md"))).toBe(original);
      expect(readlinkSync(join(root, "CLAUDE.md"))).toBe("AGENTS.md");
      expect(existsSync(join(root, "GEMINI.md"))).toBe(false);
      expect(
        execFileSync("git", ["status", "--porcelain"], {
          cwd: root,
          encoding: "utf8",
        }),
      ).toBe(status);
    },
  );

  // @req R-CAP-26
  it("ignores a pending announcement from an older bundle while retaining recall hints", () => {
    const f = fixture({ config: wired() });
    const root = checkout();
    const decisionPath = join(f.directory, "guidance", `${hash(REPO)}.json`);
    writeAtomic(decisionPath, {
      v: 1,
      repository: REPO,
      root,
      decision: "written",
      blockHash: "old",
      files: FILES,
      announce: true,
      at: NOW.getTime(),
    });
    const before = read(decisionPath);
    const event = {
      ...f.event,
      cwd: root,
      hook_event_name: "UserPromptSubmit",
      prompt: "continue",
    };
    const path = f.hook(event);
    expect(promptHint(f.directory, "claude", event, path)).toBeNull();
    writeAtomic(recallCachePath(f.directory, REPO), {
      v: 1,
      repoName: REPO,
      sessions: 5,
      fetchedAt: NOW.getTime(),
    });
    expect(promptHint(f.directory, "claude", event, path)).toBe(
      hookContextOutput("UserPromptSubmit", recallHintText(REPO, 5)),
    );
    expect(read(decisionPath)).toBe(before);
  });

  // @req R-INST-07
  it("the explicit writer preserves formatted blocks and only follows links within the repository", async () => {
    const root = checkout();
    mkdirSync(join(root, "docs"));
    const content = `# Project\n\n${BLOCK}`;
    writeFileSync(join(root, "docs", "agents.md"), content);
    symlinkSync("docs/agents.md", join(root, "AGENTS.md"));
    expect(writeRepositoryGuidance(root).changed).toEqual([]);
    expect(read(join(root, "docs", "agents.md"))).toBe(content);
    expect(
      await format(content, { parser: "markdown", proseWrap: "preserve" }),
    ).toBe(content);
    const outside = checkout();
    symlinkSync(join(root, "AGENTS.md"), join(outside, "AGENTS.md"));
    expect(writeRepositoryGuidance(outside).written).toEqual([]);
    expect(existsSync(join(outside, "CLAUDE.md"))).toBe(false);
    expect(read(join(root, "AGENTS.md"))).toBe(content);
  });

  // @req R-INST-08
  it("removes only the block from files with user text and leaves foreign links alone", () => {
    const root = checkout();
    writeFileSync(join(root, "AGENTS.md"), `# Project\n\n${BLOCK}\nAfter.\n`);
    writeFileSync(join(root, "docs.md"), "elsewhere\n");
    symlinkSync("docs.md", join(root, "GEMINI.md"));
    symlinkSync("AGENTS.md", join(root, "CLAUDE.md"));
    expect(removeRepositoryGuidance(root)).toEqual([join(root, "AGENTS.md")]);
    expect(read(join(root, "AGENTS.md"))).toBe("# Project\n\nAfter.\n");
    expect(linkTarget(join(root, "CLAUDE.md"))).toBe("AGENTS.md");
    expect(linkTarget(join(root, "GEMINI.md"))).toBe("docs.md");
    expect(removeRepositoryGuidance(root)).toEqual([]);
  });
});
