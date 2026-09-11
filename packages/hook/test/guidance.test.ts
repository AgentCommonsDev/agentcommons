import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  statSync,
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
import { writeAtomic } from "../src/files.js";
import { gitContext } from "../src/git.js";
import {
  applyRepositoryGuidance,
  guidanceAnnouncementText,
  guidanceDecisionPath,
  primaryRepositoryInstructionsFile,
  readGuidanceDecision,
  recordGuidanceCommand,
  removeRepositoryGuidance,
  repositoryBlockHash,
  writeRepositoryGuidance,
} from "../src/guidance.js";
import { HARNESSES } from "../src/harnesses.js";
import { configure } from "../src/install.js";
import {
  hookContextOutput,
  promptHint,
  recallCachePath,
  recallHintText,
  repairHintText,
} from "../src/recall.js";
import { repositoryKey } from "../src/repository.js";
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
      `Wrote the AgentCommons guidance to ${join(root, "AGENTS.md")} and linked ${join(root, "GEMINI.md")} to it.\nLeft ${join(root, "CLAUDE.md")} alone: not a regular file inside the repository.\nCommit these files so every teammate's agent reads the guidance.\n`,
    );
    expect(readlinkSync(join(root, "CLAUDE.md"))).toBe("docs.md");
    expect(read(join(root, "docs.md"))).toBe("elsewhere\n");
    expect(read(join(root, "AGENTS.md"))).toBe(BLOCK);
    // The command records its write, so the uploader neither repeats nor announces it.
    const decision = readGuidanceDecision(directory, root);
    expect(decision).toMatchObject({
      decision: "written",
      blockHash: repositoryBlockHash(),
      files: ["AGENTS.md", "GEMINI.md"],
      announce: false,
      root,
    });
  });

  // @req R-INST-08
  it("`--off` removes the block and the links it made, records the choice for the repository, and the plain command turns it back on", () => {
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
      `Removed the AgentCommons guidance from ${join(root, "AGENTS.md")}, ${join(root, "CLAUDE.md")}, ${join(root, "GEMINI.md")}.\nSessions in this repository no longer add it; run the command without --off to add it again.\n`,
    );
    // AGENTS.md held only the block, so it is gone with the link that pointed at it; user text stays.
    expect(existsSync(join(root, "AGENTS.md"))).toBe(false);
    expect(
      lstatSync(join(root, "GEMINI.md"), { throwIfNoEntry: false }),
    ).toBeUndefined();
    expect(read(join(root, "CLAUDE.md"))).toBe("Claude only rules.\n");
    // The decision is keyed by the remote, so every clone of the repository on this machine shares it.
    const key = repositoryKey({ root, remoteUrl: REMOTE });
    expect(key).toBe(REPO);
    expect(readGuidanceDecision(directory, key)).toMatchObject({
      decision: "declined",
      blockHash: null,
      announce: false,
    });
    const f = fixture({ config: wired() });
    expect(
      applyRepositoryGuidance(directory, f.config, { root, remoteUrl: REMOTE }),
    ).toBe("declined");
    expect(existsSync(join(root, "AGENTS.md"))).toBe(false);
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
    // The plain command writes again and lifts the decision.
    execFileSync(process.execPath, [executable, "guidance", "--repo", root], {
      env,
    });
    expect(read(join(root, "AGENTS.md"))).toBe(BLOCK);
    expect(readGuidanceDecision(directory, key)).toMatchObject({
      decision: "written",
      blockHash: repositoryBlockHash(),
    });
    expect(
      applyRepositoryGuidance(directory, f.config, { root, remoteUrl: REMOTE }),
    ).toBe("current");
  });
});

describe("automatic repository guidance", () => {
  // @req R-CAP-25 @req R-CAP-26
  it("is written by the uploader on a session's first run in a checkout, once, and the next hinted hook says so once", async () => {
    const f = fixture({ config: wired() });
    const root = checkout(REMOTE, f.directory);
    const path = f.hook({ cwd: root, hook_event_name: "SessionStart" });
    const options = {
      fetch: f.fetcher,
      sleep: () => Promise.resolve(),
      update: false,
      recall: false,
    };
    await upload(f.directory, SHIM, path, f.config, options);
    expect(read(join(root, "AGENTS.md"))).toBe(BLOCK);
    expect(linkTarget(join(root, "CLAUDE.md"))).toBe("AGENTS.md");
    expect(linkTarget(join(root, "GEMINI.md"))).toBe("AGENTS.md");
    expect(existsSync(join(f.directory, "AGENTS.md"))).toBe(false);
    const decisionPath = guidanceDecisionPath(f.directory, REPO);
    expect(readGuidanceDecision(f.directory, REPO)).toMatchObject({
      v: 1,
      repository: REPO,
      root,
      decision: "written",
      blockHash: repositoryBlockHash(),
      files: FILES,
      announce: true,
    });
    expect(statSync(decisionPath).mode & 0o777).toBe(0o600);
    expect(read(join(f.directory, "hook.log"))).toContain(
      `Repository guidance written in ${root}: AGENTS.md, CLAUDE.md, GEMINI.md.`,
    );
    // The next hinted event carries the one-line announcement, alone when nothing else is due.
    const prompt = {
      ...f.event,
      cwd: root,
      hook_event_name: "UserPromptSubmit",
      prompt: "hi",
    };
    const announcement = guidanceAnnouncementText(FILES);
    expect(announcement).toBe(
      "AgentCommons guidance was added to AGENTS.md (with CLAUDE.md/GEMINI.md); commit it so every teammate's agent reads it.",
    );
    expect(promptHint(f.directory, "claude", prompt, path, NOW)).toBe(
      hookContextOutput("UserPromptSubmit", announcement),
    );
    expect(readGuidanceDecision(f.directory, REPO)?.announce).toBe(false);
    expect(promptHint(f.directory, "claude", prompt, path, NOW)).toBeNull();
    // A second uploader run reads no repository file: the recorded hash is this bundle's.
    const before = statSync(join(root, "AGENTS.md")).mtimeMs;
    await upload(f.directory, SHIM, path, f.config, options);
    expect(statSync(join(root, "AGENTS.md")).mtimeMs).toBe(before);
    expect(
      applyRepositoryGuidance(f.directory, f.config, {
        root,
        remoteUrl: REMOTE,
      }),
    ).toBe("current");
    // With a recall hint due, the announcement rides behind it in the same context line.
    writeAtomic(recallCachePath(f.directory, REPO), {
      v: 2,
      repoName: REPO,
      sessions: 5,
      fetchedAt: 0,
      recent: [],
    });
    const decision = readGuidanceDecision(f.directory, REPO);
    if (!decision) throw new Error("Missing decision.");
    writeAtomic(decisionPath, { ...decision, announce: true });
    expect(promptHint(f.directory, "claude", prompt, path, NOW)).toBe(
      hookContextOutput(
        "UserPromptSubmit",
        `${recallHintText(REPO, 5)} ${announcement}`,
      ),
    );
    // A session whose harness cannot reach the server hears only the repair notice; the
    // announcement waits for a session that can act on it.
    writeAtomic(decisionPath, { ...decision, announce: true });
    const missing = wiredConfigHome(
      mkdtempSync(join(tmpdir(), "agentcommons-guidance-broken-")),
      "missing",
    );
    configure(f.directory, missing);
    const brokenPath = f.hook({
      cwd: root,
      hook_event_name: "SessionStart",
      session_id: randomUUID(),
    });
    expect(promptHint(f.directory, "claude", prompt, brokenPath, NOW)).toBe(
      hookContextOutput(
        "UserPromptSubmit",
        repairHintText(
          "claude",
          "missing",
          join(missing.installOptions.configHome, ".claude.json"),
          f.directory,
        ),
      ),
    );
    expect(readGuidanceDecision(f.directory, REPO)?.announce).toBe(true);
  });

  // @req R-CAP-25
  it("appends the block once to an existing AGENTS.md, adds only the block to an existing CLAUDE.md, adopts an identical block silently, and refreshes changed text", () => {
    const f = fixture({ config: wired() });
    const root = checkout(null);
    const repository = { root, remoteUrl: null };
    writeFileSync(join(root, "AGENTS.md"), "# Project\n\nUser rules.\n");
    writeFileSync(join(root, "CLAUDE.md"), "Claude only rules.\n");
    expect(applyRepositoryGuidance(f.directory, f.config, repository)).toBe(
      "written",
    );
    expect(read(join(root, "AGENTS.md"))).toBe(
      `# Project\n\nUser rules.\n\n${BLOCK}`,
    );
    expect(read(join(root, "CLAUDE.md"))).toBe(
      `Claude only rules.\n\n${BLOCK}`,
    );
    expect(linkTarget(join(root, "GEMINI.md"))).toBe("AGENTS.md");
    // Without a remote the decision is keyed by the checkout itself.
    const key = repositoryKey(repository);
    expect(key).toBe(root);
    expect(readGuidanceDecision(f.directory, key)).toMatchObject({
      decision: "written",
      files: FILES,
      announce: true,
    });
    expect(applyRepositoryGuidance(f.directory, f.config, repository)).toBe(
      "current",
    );
    // A release with new block text: the recorded hash differs, the block is replaced in place, once.
    writeFileSync(
      join(root, "AGENTS.md"),
      `# Project\n\nUser rules.\n\n${guidanceMarkers.begin}\nold text\n${guidanceMarkers.end}\n`,
    );
    const decision = readGuidanceDecision(f.directory, key);
    if (!decision) throw new Error("Missing decision.");
    writeAtomic(guidanceDecisionPath(f.directory, key), {
      ...decision,
      blockHash: "stale",
      announce: false,
    });
    expect(applyRepositoryGuidance(f.directory, f.config, repository)).toBe(
      "written",
    );
    expect(read(join(root, "AGENTS.md"))).toBe(
      `# Project\n\nUser rules.\n\n${BLOCK}`,
    );
    expect(
      read(join(root, "AGENTS.md")).split(guidanceMarkers.begin),
    ).toHaveLength(2);
    expect(read(join(root, "CLAUDE.md"))).toBe(
      `Claude only rules.\n\n${BLOCK}`,
    );
    expect(readGuidanceDecision(f.directory, key)).toMatchObject({
      blockHash: repositoryBlockHash(),
      announce: true,
    });
    // A checkout whose AGENTS.md already carries the block (a teammate committed it): nothing
    // changes, the decision is recorded and there is nothing to announce.
    const committed = checkout("https://github.com/acme/committed.git");
    writeFileSync(join(committed, "AGENTS.md"), `# Committed\n\n${BLOCK}`);
    symlinkSync("AGENTS.md", join(committed, "CLAUDE.md"));
    symlinkSync("AGENTS.md", join(committed, "GEMINI.md"));
    const mtime = statSync(join(committed, "AGENTS.md")).mtimeMs;
    expect(
      applyRepositoryGuidance(f.directory, f.config, {
        root: committed,
        remoteUrl: "https://github.com/acme/committed.git",
      }),
    ).toBe("adopted");
    expect(statSync(join(committed, "AGENTS.md")).mtimeMs).toBe(mtime);
    expect(
      readGuidanceDecision(f.directory, "github.com/acme/committed"),
    ).toMatchObject({
      decision: "written",
      announce: false,
    });
    expect(read(join(f.directory, "hook.log"))).not.toContain(committed);
  });

  // @req R-CAP-25
  it("adopts a block however a formatter laid it out, rewrites only changed words, and writes what prettier keeps", async () => {
    const f = fixture({ config: wired() });
    const log = () =>
      existsSync(join(f.directory, "hook.log"))
        ? read(join(f.directory, "hook.log"))
        : "";
    // The repository's own settings, as `prettier --write` runs them on `AGENTS.md`.
    const prettier = (text: string) =>
      format(text, { parser: "markdown", proseWrap: "preserve" });
    const remoteUrl = "git@github.com:acme/formatted.git";
    const repository = { root: checkout(remoteUrl), remoteUrl };
    const agents = join(repository.root, "AGENTS.md");
    const key = "github.com/acme/formatted";
    // Observed live on 2026-09-11: this repository's AGENTS.md carried the committed block,
    // formatted by prettier, and the writer rewrote it to remove two blank lines that the
    // pre-commit prettier run put back. The writer's layout is now prettier's own.
    const committed = await prettier(
      `# Working in this repo\n\nRules people wrote.\n\n${BLOCK}`,
    );
    expect(committed).toBe(
      `# Working in this repo\n\nRules people wrote.\n\n${BLOCK}`,
    );
    writeFileSync(agents, committed);
    symlinkSync("AGENTS.md", join(repository.root, "CLAUDE.md"));
    symlinkSync("AGENTS.md", join(repository.root, "GEMINI.md"));
    const mtime = statSync(agents).mtimeMs;
    expect(applyRepositoryGuidance(f.directory, f.config, repository)).toBe(
      "adopted",
    );
    expect(read(agents)).toBe(committed);
    expect(statSync(agents).mtimeMs).toBe(mtime);
    const decision = readGuidanceDecision(f.directory, key);
    expect(decision).toMatchObject({
      repository: key,
      decision: "written",
      blockHash: repositoryBlockHash(),
      files: ["AGENTS.md"],
      announce: false,
    });
    if (!decision) throw new Error("Missing decision.");
    expect(log()).not.toContain(repository.root);
    // Blank lines and trailing whitespace never count as a difference: the layout an older
    // bundle wrote (no blank line after the marker or the heading) and a sloppy hand edit
    // are both the same block, so a release whose hash differs still leaves them alone.
    for (const layout of [
      `# P\n\n${guidanceMarkers.begin}\n${repositoryInstructions.replace("\n\n", "\n")}\n${guidanceMarkers.end}\n`,
      `# P\n\n\n${guidanceMarkers.begin}\n\n\n${repositoryInstructions.replaceAll("\n", "  \n")}\n\n${guidanceMarkers.end}\n\n`,
    ]) {
      writeFileSync(agents, layout);
      writeAtomic(guidanceDecisionPath(f.directory, key), {
        ...decision,
        blockHash: "stale",
      });
      expect(applyRepositoryGuidance(f.directory, f.config, repository)).toBe(
        "adopted",
      );
      expect(read(agents)).toBe(layout);
      expect(readGuidanceDecision(f.directory, key)).toMatchObject({
        blockHash: repositoryBlockHash(),
        announce: false,
      });
    }
    expect(log()).not.toContain(repository.root);
    // Older words are rewritten, once, in a layout prettier leaves unchanged.
    writeFileSync(
      agents,
      `# P\n\n${guidanceMarkers.begin}\n\n## AgentCommons\n\nOlder text.\n${guidanceMarkers.end}\n`,
    );
    writeAtomic(guidanceDecisionPath(f.directory, key), {
      ...decision,
      blockHash: "stale",
    });
    expect(applyRepositoryGuidance(f.directory, f.config, repository)).toBe(
      "written",
    );
    expect(read(agents)).toBe(`# P\n\n${BLOCK}`);
    expect(await prettier(read(agents))).toBe(read(agents));
    expect(readGuidanceDecision(f.directory, key)?.announce).toBe(true);
    expect(log()).toContain(
      `Repository guidance written in ${repository.root}: AGENTS.md.`,
    );
    // The same holds for a block that sat in the middle of a file, for a fresh file, and
    // for a file whose trailing blank lines would otherwise pile up before the block.
    const cases: [string, string][] = [
      [
        `# P\n\n${guidanceMarkers.begin}\nold\n${guidanceMarkers.end}\n\nAfter.\n`,
        `# P\n\nAfter.\n\n${BLOCK}`,
      ],
      ["", BLOCK],
      ["# P\n\n\n\n", `# P\n\n${BLOCK}`],
    ];
    for (const [before, after] of cases) {
      const root = checkout(null);
      writeFileSync(join(root, "AGENTS.md"), before);
      expect(writeRepositoryGuidance(root).changed).toEqual([
        join(root, "AGENTS.md"),
      ]);
      expect(read(join(root, "AGENTS.md"))).toBe(after);
      expect(await prettier(after)).toBe(after);
    }
  });

  // @req R-CAP-25
  it("keys the decision on the checkout's current origin, not on the remote the session state recorded", () => {
    const f = fixture({ config: wired() });
    // The session began while `origin` was still `acme/old`; its state keeps that URL, the
    // checkout has since been renamed.
    const root = checkout("git@github.com:acme/renamed.git");
    const stale = { root, remoteUrl: "git@github.com:acme/old.git" };
    expect(applyRepositoryGuidance(f.directory, f.config, stale)).toBe(
      "written",
    );
    expect(
      readGuidanceDecision(f.directory, "github.com/acme/renamed"),
    ).toMatchObject({
      repository: "github.com/acme/renamed",
      root,
      decision: "written",
    });
    expect(readGuidanceDecision(f.directory, "github.com/acme/old")).toBeNull();
    expect(applyRepositoryGuidance(f.directory, f.config, stale)).toBe(
      "current",
    );
    // A checkout that lost its remote is keyed by its root, whatever the state remembers.
    const local = checkout(null);
    expect(
      applyRepositoryGuidance(f.directory, f.config, {
        root: local,
        remoteUrl: REMOTE,
      }),
    ).toBe("written");
    expect(readGuidanceDecision(f.directory, local)).toMatchObject({
      repository: local,
      root: local,
    });
    expect(readGuidanceDecision(f.directory, REPO)).toBeNull();
  });

  // @req R-CAP-25
  it("is gated by guidance.auto in config.json and by AGENTCOMMONS_GUIDANCE_AUTO", () => {
    const root = checkout();
    const repository = { root, remoteUrl: REMOTE };
    const off = fixture({ config: { ...wired(), guidance: { auto: false } } });
    expect(off.config.guidance).toEqual({ auto: false });
    expect(applyRepositoryGuidance(off.directory, off.config, repository)).toBe(
      "disabled",
    );
    const on = fixture({ config: wired() });
    expect(on.config.guidance).toEqual({ auto: true });
    vi.stubEnv("AGENTCOMMONS_GUIDANCE_AUTO", "0");
    expect(applyRepositoryGuidance(on.directory, on.config, repository)).toBe(
      "disabled",
    );
    expect(existsSync(join(root, "AGENTS.md"))).toBe(false);
    // `1` wins over a configuration that turned it off.
    vi.stubEnv("AGENTCOMMONS_GUIDANCE_AUTO", "1");
    expect(applyRepositoryGuidance(off.directory, off.config, repository)).toBe(
      "written",
    );
    expect(read(join(root, "AGENTS.md"))).toBe(BLOCK);
    // Off means off: a recorded `--off` is honoured before any file is read.
    const declined = checkout("https://github.com/acme/declined.git");
    recordGuidanceCommand(on.directory, declined, "declined", []);
    vi.unstubAllEnvs();
    expect(
      applyRepositoryGuidance(on.directory, on.config, {
        root: declined,
        remoteUrl: "https://github.com/acme/declined.git",
      }),
    ).toBe("declined");
    expect(existsSync(join(declined, "AGENTS.md"))).toBe(false);
  });

  // @req R-CAP-25
  it("skips a root without its own .git, node_modules, bare and read-only checkouts, and links that leave the repository; a nested directory writes at its root", () => {
    const f = fixture({ config: wired() });
    // Not a working tree root: no `.git` (and `hook.js guidance` alone may still write there).
    const plain = mkdtempSync(join(tmpdir(), "agentcommons-plain-"));
    expect(
      applyRepositoryGuidance(f.directory, f.config, {
        root: plain,
        remoteUrl: null,
      }),
    ).toBe("skipped");
    expect(existsSync(join(plain, "AGENTS.md"))).toBe(false);
    // A checkout under node_modules is somebody else's package.
    const modules = join(
      mkdtempSync(join(tmpdir(), "agentcommons-modules-")),
      "node_modules",
    );
    mkdirSync(modules);
    const dependency = checkout(REMOTE, modules);
    expect(
      applyRepositoryGuidance(f.directory, f.config, {
        root: dependency,
        remoteUrl: REMOTE,
      }),
    ).toBe("skipped");
    expect(existsSync(join(dependency, "AGENTS.md"))).toBe(false);
    // A bare repository has no working tree: git reports no root, and the directory has no `.git`.
    const bare = mkdtempSync(join(tmpdir(), "agentcommons-bare-"));
    execFileSync("git", ["init", "-q", "--bare"], { cwd: bare });
    expect(gitContext(bare)).toBeNull();
    expect(
      applyRepositoryGuidance(f.directory, f.config, gitContext(bare)),
    ).toBe("skipped");
    expect(
      applyRepositoryGuidance(f.directory, f.config, {
        root: bare,
        remoteUrl: null,
      }),
    ).toBe("skipped");
    expect(existsSync(join(bare, "AGENTS.md"))).toBe(false);
    // A nested directory belongs to the enclosing checkout; the block lands at its root only.
    const root = checkout("https://github.com/acme/nested.git");
    const nested = join(root, "packages", "deep");
    mkdirSync(nested, { recursive: true });
    const context = gitContext(nested);
    expect(context?.root).toBe(root);
    expect(applyRepositoryGuidance(f.directory, f.config, context)).toBe(
      "written",
    );
    expect(read(join(root, "AGENTS.md"))).toBe(BLOCK);
    expect(existsSync(join(nested, "AGENTS.md"))).toBe(false);
    // A linked worktree has its own `.git` file and is a checkout in its own right.
    execFileSync(
      "git",
      [
        "-c",
        "user.name=t",
        "-c",
        "user.email=t@example.com",
        "commit",
        "-q",
        "--allow-empty",
        "-m",
        "init",
      ],
      { cwd: root },
    );
    const worktree = join(root, "wt");
    execFileSync("git", ["worktree", "add", "-q", worktree], { cwd: root });
    expect(lstatSync(join(worktree, ".git")).isFile()).toBe(true);
    // Same remote, so the repository's decision already stands: nothing is written there.
    expect(
      applyRepositoryGuidance(f.directory, f.config, gitContext(worktree)),
    ).toBe("current");
    expect(existsSync(join(worktree, "AGENTS.md"))).toBe(false);
    // AGENTS.md as a symlink: followed inside the repository, never outside it.
    const inside = checkout("https://github.com/acme/inside.git");
    mkdirSync(join(inside, "docs"));
    writeFileSync(join(inside, "docs", "agents.md"), "# Docs\n");
    symlinkSync(join("docs", "agents.md"), join(inside, "AGENTS.md"));
    expect(
      applyRepositoryGuidance(f.directory, f.config, {
        root: inside,
        remoteUrl: "https://github.com/acme/inside.git",
      }),
    ).toBe("written");
    expect(readlinkSync(join(inside, "AGENTS.md"))).toBe(
      join("docs", "agents.md"),
    );
    expect(read(join(inside, "docs", "agents.md"))).toBe(`# Docs\n\n${BLOCK}`);
    expect(linkTarget(join(inside, "CLAUDE.md"))).toBe("AGENTS.md");
    const outside = checkout("https://github.com/acme/outside.git");
    const elsewhere = join(
      mkdtempSync(join(tmpdir(), "agentcommons-elsewhere-")),
      "AGENTS.md",
    );
    writeFileSync(elsewhere, "# Elsewhere\n");
    symlinkSync(elsewhere, join(outside, "AGENTS.md"));
    expect(
      applyRepositoryGuidance(f.directory, f.config, {
        root: outside,
        remoteUrl: "https://github.com/acme/outside.git",
      }),
    ).toBe("skipped");
    expect(read(elsewhere)).toBe("# Elsewhere\n");
    expect(existsSync(join(outside, "CLAUDE.md"))).toBe(false);
    expect(existsSync(join(outside, "GEMINI.md"))).toBe(false);
    expect(
      readGuidanceDecision(f.directory, "github.com/acme/outside"),
    ).toBeNull();
  });

  // @req R-CAP-25
  it.skipIf(process.getuid?.() === 0)(
    "leaves a read-only checkout alone",
    () => {
      const f = fixture({ config: wired() });
      const root = checkout("https://github.com/acme/readonly.git");
      chmodSync(root, 0o555);
      try {
        expect(
          applyRepositoryGuidance(f.directory, f.config, {
            root,
            remoteUrl: "https://github.com/acme/readonly.git",
          }),
        ).toBe("skipped");
        expect(existsSync(join(root, "AGENTS.md"))).toBe(false);
        expect(
          readGuidanceDecision(f.directory, "github.com/acme/readonly"),
        ).toBeNull();
      } finally {
        chmodSync(root, 0o755);
      }
    },
  );

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
