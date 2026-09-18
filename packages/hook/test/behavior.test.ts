import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  writeFileSync,
  appendFileSync,
  mkdirSync,
  statSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { expect, it, vi, afterEach } from "vitest";
import { recordHook } from "../src/hook.js";
import {
  intentFileName,
  intents,
  journalPath,
  loadState,
  quarantinePath,
  type Intent,
} from "../src/state.js";
import { hash, writeAtomic } from "../src/files.js";
import { HARNESSES } from "../src/harnesses.js";
import {
  readSource,
  initialCursor,
  OversizedSourceRecord,
  quarantineOversized,
} from "../src/readers.js";
import { upload } from "../src/upload.js";
import { gitContext, gitEnd } from "../src/git.js";
import { fixture } from "./fixture.js";

afterEach(() => vi.unstubAllEnvs());
const git = (
  cwd: string,
  args: string[],
  env: Record<string, string> = {},
): string =>
  execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    env: { ...process.env, ...env },
  }).trim();
// @req R-CAP-12
it("terminates a stalled git observation without waiting for the command to finish", () => {
  const directory = mkdtempSync(join(tmpdir(), "agentcommons-slow-git-"));
  const pidFile = join(directory, "git.pid");
  writeFileSync(
    join(directory, "git"),
    `#!/bin/sh\nprintf '%s' "$$" > '${pidFile}'\nexec /bin/sleep 5\n`,
    { mode: 0o700 },
  );
  vi.stubEnv("PATH", directory);
  const started = performance.now();
  expect(gitContext(directory)).toBeNull();
  expect(performance.now() - started).toBeLessThan(1500);
  const pid = Number(readFileSync(pidFile, "utf8"));
  expect(Number.isSafeInteger(pid)).toBe(true);
  expect(() => process.kill(pid, 0)).toThrow();
});
// @req R-CAP-02 @req R-CAP-03 @req R-CAP-13
it("journals lifecycle and due sync intents, honors tool thresholds, and skips disabled paths", async () => {
  const f = fixture();
  const path = f.hook();
  await upload(f.directory, "/nonexistent-test-shim.js", path, f.config, {
    fetch: f.fetcher,
    sweep: false,
  });
  f.hook({ ...f.event, hook_event_name: "PostToolUse" });
  expect(intents(path, loadState(path))).toHaveLength(0);
  f.hook({ ...f.event, hook_event_name: "UserPromptSubmit" });
  expect(
    intents(path, loadState(path)).map((intent) => intent.behavior),
  ).toEqual(["sync"]);
  await upload(f.directory, "/nonexistent-test-shim.js", path, f.config, {
    fetch: f.fetcher,
    sweep: false,
  });
  appendFileSync(f.transcript, " ".repeat(65536));
  f.hook({ ...f.event, hook_event_name: "PostToolUse" });
  expect(intents(path, loadState(path))).toHaveLength(1);
  await upload(f.directory, "/nonexistent-test-shim.js", path, f.config, {
    fetch: f.fetcher,
    sweep: false,
  });
  expect(intents(path, loadState(path))).toHaveLength(0);
  f.config.syncBytesThreshold = Number.MAX_SAFE_INTEGER;
  appendFileSync(f.transcript, '\n{"uuid":"timer-only"}\n');
  const later = loadState(path);
  later.lastSyncAt = Date.now() - 10001;
  writeAtomic(path, later);
  f.hook({
    ...f.event,
    hook_event_name: "PostToolUse",
  });
  expect(intents(path, loadState(path))).toHaveLength(1);
  f.hook({ ...f.event, hook_event_name: "SessionEnd" });
  expect(
    intents(path, loadState(path)).some((intent) => intent.behavior === "end"),
  ).toBe(true);
  expect(
    recordHook(
      f.directory,
      "/none",
      { ...f.config, disabledPaths: [f.directory] },
      "claude",
      f.event,
    ),
  ).toBeNull();
  vi.stubEnv("AGENTCOMMONS_DISABLE", "1");
  expect(
    recordHook(f.directory, "/none", f.config, "claude", f.event),
  ).toBeNull();
});
// @req R-CAP-08
it("sweeps only the oldest other pending session", async () => {
  const f = fixture();
  const own = f.hook();
  const oldest = f.hook({ ...f.event, session_id: randomUUID() });
  const newer = f.hook({ ...f.event, session_id: randomUUID() });
  const oldState = loadState(oldest);
  oldState.lastSyncAt = 1;
  writeAtomic(oldest, oldState);
  const newState = loadState(newer);
  newState.lastSyncAt = 2;
  writeAtomic(newer, newState);
  await upload(f.directory, "/none", own, f.config, { fetch: f.fetcher });
  expect(new Set(f.received.map((body) => body.harnessSessionId))).toEqual(
    new Set([f.event.session_id, oldState.sessionId]),
  );
  expect(intents(newer, loadState(newer))).toHaveLength(1);
});
// @req R-CAP-09 @req R-LNK-01
it("flushes a captured child source independently and preserves the parent transcript path", async () => {
  const f = fixture();
  const path = f.hook();
  const child = join(
    f.directory,
    f.event.session_id,
    "subagents",
    "agent-child.jsonl",
  );
  mkdirSync(join(f.directory, f.event.session_id, "subagents"), {
    recursive: true,
  });
  writeFileSync(child, '{"uuid":"child-message"}\n');
  recordHook(f.directory, "/none", f.config, "claude", {
    ...f.event,
    hook_event_name: "SubagentStart",
    agent_id: "child",
    agent_type: "Explore",
  });
  await upload(f.directory, "/none", path, f.config, {
    fetch: f.fetcher,
    sweep: false,
  });
  const childBatch = f.received.find(
    (body) =>
      body.harnessSessionId.endsWith(":agent-child") && body.records.length > 0,
  );
  expect(childBatch?.records[0]?.key).toBe("child-message");
  expect(childBatch?.context.parentHint).toMatchObject({
    harnessSessionId: f.event.session_id,
    relation: "SUBAGENT",
    agentType: "Explore",
  });
  expect(loadState(path).transcriptPath).toBe(f.transcript);
  recordHook(f.directory, "/none", f.config, "claude", {
    ...f.event,
    hook_event_name: "SubagentStop",
    agent_id: "child",
    agent_transcript_path: child,
  });
  await upload(f.directory, "/none", path, f.config, {
    fetch: f.fetcher,
    sweep: false,
  });
  expect(loadState(path).children).toHaveLength(1);
  expect(
    f.received
      .filter((body) => body.harnessSessionId.endsWith(":agent-child"))
      .map((body) => body.behavior),
  ).toEqual(["start", "sync", "end"]);
  expect(
    new Set(
      f.received
        .filter((body) => body.context.parentHint?.relation === "SUBAGENT")
        .map((body) => body.harnessSessionId),
    ),
  ).toEqual(new Set([`${f.event.session_id}:agent-child`]));
});
// @req R-CAP-11 @req R-CAP-14
it("resets truncated sources and preserves oversized bytes before returning an acknowledgment cursor", () => {
  const f = fixture();
  const first = readSource(
    f.transcript,
    initialCursor(HARNESSES.claude),
    HARNESSES.claude,
    0,
  );
  writeFileSync(f.transcript, "{}\n");
  const reset = readSource(f.transcript, first.cursor, HARNESSES.claude, 0);
  expect(reset.records[0]?.pos).toBe(0);
  writeFileSync(f.transcript, 'large-record\n{"uuid":"next"}\n');
  const directory = join(f.directory, "quarantine");
  const held = quarantineOversized(
    new OversizedSourceRecord(f.transcript, 0),
    { kind: "jsonl", offset: 0 },
    statSync(f.transcript).size,
    directory,
  );
  expect(held.cursor).toEqual({ kind: "jsonl", offset: 13 });
  const file = readdirSync(directory).find((name) => name.endsWith(".raw"));
  if (!file) throw new Error("Missing retained source bytes.");
  expect(readFileSync(join(directory, file), "utf8")).toBe("large-record\n");
  expect(statSync(directory).mode & 0o777).toBe(0o700);
  expect(statSync(join(directory, file)).mode & 0o777).toBe(0o600);
  expect(
    readSource(f.transcript, held.cursor, HARNESSES.claude, 0).records[0]?.key,
  ).toBe("next");
});
// @req R-CAP-12
it("collects end observations in a detached worktree with committed and dirty files", async () => {
  const f = fixture();
  git(f.directory, ["init"]);
  git(f.directory, ["config", "user.name", "Fixture"]);
  git(f.directory, ["config", "user.email", "fixture@example.test"]);
  writeFileSync(join(f.directory, "tracked"), "first\n");
  git(f.directory, ["add", "tracked"]);
  git(f.directory, ["commit", "-m", "initial"]);
  const initial = git(f.directory, ["rev-parse", "HEAD"]);
  const worktree = join(f.directory, "worktree");
  git(f.directory, ["worktree", "add", "--detach", worktree, initial]);
  const path = f.hook({
    ...f.event,
    cwd: worktree,
    hook_event_name: "SessionStart",
  });
  // `guidance: false`: the dirty-file count below must see only the file this test writes.
  await upload(f.directory, "/none", path, f.config, {
    fetch: f.fetcher,
    sweep: false,
    guidance: false,
  });
  writeFileSync(join(worktree, "tracked"), "first\nsecond\n");
  git(worktree, ["commit", "-am", "observed commit"]);
  writeFileSync(join(worktree, "dirty"), "pending\n");
  expect(gitContext(worktree)).toMatchObject({ root: worktree, branch: null });
  const end = gitEnd(worktree, initial, "exit");
  expect(end?.observedCommits[0]?.subject).toBe("observed commit");
  expect(end?.observedDiffStat).toEqual({ files: 1, added: 1, removed: 0 });
  expect(end?.dirtyFileCount).toBe(1);
  f.hook({ ...f.event, cwd: worktree, hook_event_name: "SessionEnd" });
  await upload(f.directory, "/none", path, f.config, {
    fetch: f.fetcher,
    sweep: false,
    guidance: false,
  });
  expect(f.received.find((body) => body.behavior === "end")?.end).toMatchObject(
    { observedDiffStat: { files: 1, added: 1, removed: 0 }, dirtyFileCount: 1 },
  );
});
// @req R-HRN-07 @req R-ARCH-06
it("all four captured harness entries choose their reader, timeout, MCP shape, and a dependency-free artifact", () => {
  expect(Object.keys(HARNESSES)).toEqual(["claude", "codex", "gemini", "pi"]);
  expect(HARNESSES.gemini.reader).toBe("json-document");
  expect(HARNESSES.gemini.timeout).toBe(3000);
  expect(HARNESSES.pi.events.session_tree?.behavior).toBe("sync");
  expect(
    HARNESSES.codex.mcp("https://example.test/mcp", "ac_test", {
      directory: "/opt/agentcommons",
      node: "/usr/bin/node",
      server: "https://example.test",
    }),
  ).toEqual({
    command: "/usr/bin/node",
    args: [join("/opt/agentcommons", "hook.js"), "mcp"],
    env: {
      AGENTCOMMONS_API_KEY: "ac_test",
      AGENTCOMMONS_SERVER: "https://example.test",
    },
  });
  const manifest: unknown = JSON.parse(
    readFileSync("packages/hook/package.json", "utf8"),
  );
  expect(manifest).not.toHaveProperty("dependencies");
});
it("refuses to send an old spool under a key from another organization", async () => {
  const f = fixture();
  const path = f.hook();
  await upload(f.directory, "/none", path, f.config, {
    fetch: f.fetcher,
    sweep: false,
  });
  appendFileSync(f.transcript, '{"uuid":"private"}\n');
  f.hook();
  let posts = 0;
  await upload(
    f.directory,
    "/none",
    path,
    { ...f.config, key: "other-organization" },
    {
      sweep: false,
      fetch: (_url, options) => {
        if (options?.method === "POST") posts++;
        return Promise.resolve(
          Response.json({
            organization: { id: "019939c0-0000-7000-8000-000000000002" },
          }),
        );
      },
    },
  );
  expect(posts).toBe(0);
  expect(loadState(path).suspended?.code).toBe(409);
  expect(intents(path, loadState(path))).toHaveLength(1);
});

// @req R-LNK-03
it("transports the explicit parent environment as a SPAWNED hint for every harness", async () => {
  const f = fixture();
  vi.stubEnv("AGENTCOMMONS_PARENT_SESSION_ID", "explicit-parent");
  for (const [name, definition] of Object.entries(HARNESSES)) {
    const harness = (
      await import("../src/harnesses.js")
    ).cliHarnessSchema.parse(name);
    const nativeEvent = Object.entries(definition.events).find(
      ([, event]) => event.behavior === "start",
    )?.[0];
    if (!nativeEvent) throw new Error("Missing native start event.");
    const path = recordHook(f.directory, "/none", f.config, harness, {
      session_id: randomUUID(),
      cwd: f.directory,
      hook_event_name: nativeEvent,
    });
    if (!path) throw new Error("Missing state.");
    await upload(f.directory, "/none", path, f.config, {
      fetch: f.fetcher,
      sweep: false,
    });
  }
  expect(f.received).toHaveLength(4);
  expect(
    f.received.every(
      (body) =>
        body.context.parentHint?.harnessSessionId === "explicit-parent" &&
        body.context.parentHint.relation === "SPAWNED",
    ),
  ).toBe(true);
});

it("keeps parallel child starts distinct when their parent source and prompt are identical", async () => {
  const f = fixture();
  const path = f.hook();
  for (const id of ["first", "second"]) {
    const child = join(
      f.directory,
      f.event.session_id,
      "subagents",
      `agent-${id}.jsonl`,
    );
    mkdirSync(join(f.directory, f.event.session_id, "subagents"), {
      recursive: true,
    });
    writeFileSync(child, JSON.stringify({ uuid: id }) + "\n");
    recordHook(f.directory, "/none", f.config, "claude", {
      ...f.event,
      hook_event_name: "SubagentStart",
      prompt_id: "same-prompt",
      agent_id: id,
    });
  }
  await upload(f.directory, "/none", path, f.config, {
    fetch: f.fetcher,
    sweep: false,
  });
  expect(loadState(path).children).toHaveLength(2);
  expect(
    f.received
      .filter(
        (body) =>
          body.context.parentHint?.relation === "SUBAGENT" &&
          body.records.length,
      )
      .map((body) => body.records[0]?.key)
      .sort(),
  ).toEqual(["first", "second"]);
});

it("keeps bridge lifecycle identity and native ordering when detached hooks arrive out of order", async () => {
  const f = fixture();
  const start = {
    session_id: randomUUID(),
    cwd: f.directory,
    hook_event_name: "session_start",
    reason: "resume",
    event_id: "native-observation-start",
    timestamp: "2026-09-08T00:00:02.000Z",
  };
  const path = recordHook(f.directory, "/none", f.config, "pi", start);
  if (!path) throw new Error("Missing state.");
  recordHook(f.directory, "/none", f.config, "pi", {
    ...start,
    hook_event_name: "session_shutdown",
    event_id: "native-observation-end",
    timestamp: "2026-09-08T00:00:01.000Z",
  });
  recordHook(f.directory, "/none", f.config, "pi", start);
  await upload(f.directory, "/none", path, f.config, {
    fetch: f.fetcher,
    sweep: false,
  });
  expect(f.received.map((body) => [body.behavior, body.sentAt])).toEqual([
    ["end", "2026-09-08T00:00:01.000Z"],
    ["start", "2026-09-08T00:00:02.000Z"],
  ]);
  recordHook(f.directory, "/none", f.config, "pi", {
    ...start,
    event_id: "later-empty-resume",
    timestamp: "2026-09-08T00:00:03.000Z",
  });
  await upload(f.directory, "/none", path, f.config, {
    fetch: f.fetcher,
    sweep: false,
  });
  expect(f.received.filter((body) => body.start?.resume)).toHaveLength(2);
});

// @req R-HRN-05
it("forwards bridge host metadata as normalizer context on every pi envelope", async () => {
  const f = fixture();
  const metadata = { harnessVersion: "0.73.1", entrypoint: "headless" };
  const event = {
    session_id: randomUUID(),
    cwd: f.directory,
    hook_event_name: "session_start",
    reason: "startup",
    event_id: "host-metadata-start",
    timestamp: "2026-09-08T00:00:01.000Z",
    activeLeafId: null,
    transcript_metadata: metadata,
  };
  const path = recordHook(f.directory, "/none", f.config, "pi", event);
  if (!path) throw new Error("Missing state.");
  expect(intents(path, loadState(path))[0]?.context.transcriptMetadata).toEqual(
    metadata,
  );
  recordHook(f.directory, "/none", f.config, "pi", {
    ...event,
    hook_event_name: "session_shutdown",
    reason: "quit",
    event_id: "host-metadata-end",
    timestamp: "2026-09-08T00:00:02.000Z",
  });
  await upload(f.directory, "/none", path, f.config, {
    fetch: f.fetcher,
    sweep: false,
  });
  expect(
    f.received.map((body) => [body.behavior, body.context.transcriptMetadata]),
  ).toEqual([
    ["start", metadata],
    ["end", metadata],
  ]);
  // Hooks without host metadata (other harnesses) leave the context untouched.
  const plain = recordHook(f.directory, "/none", f.config, "claude", {
    session_id: randomUUID(),
    transcript_path: f.transcript,
    cwd: f.directory,
    hook_event_name: "SessionStart",
  });
  if (!plain) throw new Error("Missing state.");
  expect(
    intents(plain, loadState(plain))[0]?.context.transcriptMetadata,
  ).toBeUndefined();
});

it("quarantines an actually oversized complete JSONL record and still uploads the next record", async () => {
  const f = fixture();
  const oversized =
    JSON.stringify({ uuid: "oversized", text: "x".repeat(50 * 1024 * 1024) }) +
    "\n";
  writeFileSync(f.transcript, oversized + '{"uuid":"next"}\n');
  const path = f.hook();
  await upload(f.directory, "/none", path, f.config, {
    fetch: f.fetcher,
    sweep: false,
  });
  expect(
    f.received.flatMap((body) => body.records.map((record) => record.key)),
  ).toEqual(["next"]);
  expect(loadState(path).ackedCursor).toEqual({
    kind: "jsonl",
    offset: statSync(f.transcript).size,
  });
  const directory = join(quarantinePath(path), "raw");
  const file = readdirSync(directory).find((name) => name.endsWith(".raw"));
  if (!file) throw new Error("Missing oversized quarantine.");
  expect(readFileSync(join(directory, file), "utf8")).toBe(oversized);
});

// @req R-INST-06
it("carries the global agent guidance exactly as specified", async () => {
  const { agentInstructions } = await import("../src/install.js");
  const spec = readFileSync("docs/SPEC.md", "utf8");
  const section = spec.slice(
    spec.indexOf("### 8.3 Global agent instructions"),
    spec.indexOf("### 8.4 Client configuration"),
  );
  expect(section.match(/```\n([\s\S]*?)\n```/)?.[1]).toBe(agentInstructions);
});

it("reads indexed backlog heads without losing the latest source or lifecycle phase", async () => {
  const f = fixture();
  const path = f.hook();
  const { recentIntents, latestPhase, latestSource } =
    await import("../src/state.js");
  const original = intents(path, loadState(path))[0];
  if (!original) throw new Error("Missing journal entry.");
  for (let index = 0; index < 1200; index++) {
    const id = hash(String(index));
    const time = new Date(
      Date.parse(original.sentAt) + index + 1,
    ).toISOString();
    const behavior: Intent["behavior"] =
      index === 50 ? "start" : index === 1100 ? "end" : "sync";
    const intent = {
      ...original,
      id,
      sentAt: time,
      behavior,
      source: { ...original.source, watermark: index },
      preceding: "previous-phase",
    };
    writeFileSync(
      join(journalPath(path), intentFileName(intent)),
      JSON.stringify(intent),
    );
  }
  const state = loadState(path);
  const recent = recentIntents(path, state);
  const all = intents(path, state);
  expect(recent.length).toBeLessThanOrEqual(3);
  expect(latestSource(state, recent)).toEqual(latestSource(state, all));
  expect(latestPhase(state, recent)).toEqual(latestPhase(state, all));
});

// @req R-CAP-12
it("reports the commit the session started from even when the first upload drains after a later commit", async () => {
  const f = fixture();
  const dated = (time: string) => ({
    GIT_AUTHOR_DATE: time,
    GIT_COMMITTER_DATE: time,
  });
  git(f.directory, ["init"]);
  git(f.directory, ["config", "user.name", "Fixture"]);
  git(f.directory, ["config", "user.email", "fixture@example.test"]);
  writeFileSync(join(f.directory, "tracked"), "first\n");
  git(f.directory, ["add", "tracked"]);
  git(
    f.directory,
    ["commit", "-m", "before start"],
    dated("2026-09-08T00:00:00Z"),
  );
  const before = git(f.directory, ["rev-parse", "HEAD"]);
  const path = recordHook(f.directory, "/none", f.config, "claude", {
    ...f.event,
    hook_event_name: "SessionStart",
    timestamp: "2026-09-08T00:00:05.000Z",
  });
  if (!path) throw new Error("Missing state.");
  // The agent commits before the detached uploader gets to observe git context.
  writeFileSync(join(f.directory, "tracked"), "first\nsecond\n");
  git(
    f.directory,
    ["commit", "-am", "during session"],
    dated("2026-09-08T00:00:10Z"),
  );
  const after = git(f.directory, ["rev-parse", "HEAD"]);
  await upload(f.directory, "/none", path, f.config, {
    fetch: f.fetcher,
    sweep: false,
  });
  expect(f.received[0]?.context.git?.head).toBe(before);
  expect(gitContext(f.directory)?.head).toBe(after);
  expect(gitContext(f.directory, "2026-09-08T00:00:05Z")?.head).toBe(before);
  // A start older than the whole reflog falls back to the current HEAD.
  expect(gitContext(f.directory, "2020-01-01T00:00:00Z")?.head).toBe(after);
  f.hook({ ...f.event, hook_event_name: "SessionEnd" });
  await upload(f.directory, "/none", path, f.config, {
    fetch: f.fetcher,
    sweep: false,
  });
  expect(
    f.received.find((body) => body.behavior === "end")?.end?.observedCommits,
  ).toMatchObject([{ sha: after, subject: "during session" }]);
});
