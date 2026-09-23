import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { hash, writeAtomic } from "../src/files.js";
import {
  HARNESSES,
  preToolPayloadSchema,
  type CliHarness,
} from "../src/harnesses.js";
import { enforcePreTool } from "../src/hook.js";
import { configure } from "../src/install.js";
import {
  RECALL_HINT_EVERY_PROMPTS,
  RECALL_RECENT_LIMIT,
  RECALL_REFRESH_MS,
  beforeEditDedupPath,
  beforeEditHint,
  beforeEditHintText,
  hintCounterPath,
  hookContextOutput,
  matchRecent,
  matchedHintText,
  promptHint,
  rankRecent,
  recallCachePath,
  recallHintText,
  refreshRecallHint,
  repairHintText,
  startHintText,
  type RecentSession,
} from "../src/recall.js";
import { registrationStatus } from "../src/registration.js";
import { repositoryNameFromCwd } from "../src/repository.js";
import { loadState } from "../src/state.js";
import { upload } from "../src/upload.js";
import { SHIM, fixture, stubFetch, wiredConfigHome } from "./fixture.js";

/**
 * A real checkout with `origin`: the shim names a repository from its `.git/config` as it
 * is now (`repositoryAt`), never from the remote a session state recorded.
 */
const ROOT = mkdtempSync(join(tmpdir(), "agentcommons-recall-repo-"));
execFileSync("git", ["init", "-q"], { cwd: ROOT });
execFileSync(
  "git",
  ["remote", "add", "origin", "git@github.com:acme/widgets.git"],
  { cwd: ROOT },
);
const GIT = {
  root: ROOT,
  remoteUrl: "git@github.com:acme/widgets.git",
  branch: "main",
  head: null,
};
const REPO = "github.com/acme/widgets";
const NOW = new Date("2026-09-11T12:00:00Z");
/** A cached session with the distill fields at their no-signal defaults unless overridden. */
const session = (
  fields: Pick<RecentSession, "id" | "title" | "startedAt" | "branch"> &
    Partial<RecentSession>,
): RecentSession => ({
  reuseCount: 0,
  byTeammate: false,
  messageCount: 0,
  endReason: null,
  files: [],
  ...fields,
});
const recent: RecentSession[] = [
  session({
    id: "01a08fd7-9907-72a3-9135-80162670d93a",
    title: "Fix the inventory timeout in src/inventory.js",
    startedAt: "2026-09-10T12:00:00Z",
    branch: "main",
  }),
  session({
    id: "01a08fd7-9667-7163-a987-86201f0e0eb3",
    title: "Retry payments the way the provider requires",
    startedAt: "2026-09-09T12:00:00Z",
    branch: "fix/payments-retry",
  }),
  session({
    id: "01a08fd7-93e7-7257-84df-b7f4f8ba44dd",
    title: "Fake clock for the TTL cache test",
    startedAt: "2026-09-08T12:00:00Z",
    branch: "main",
  }),
];
const cache = (
  directory: string,
  sessions: number,
  options: { fetchedAt?: number; recent?: RecentSession[]; v?: 1 | 2 } = {},
) => {
  writeAtomic(
    recallCachePath(directory, REPO),
    options.v === 1
      ? { v: 1, repoName: REPO, sessions, fetchedAt: options.fetchedAt ?? 0 }
      : {
          v: 2,
          repoName: REPO,
          sessions,
          fetchedAt: options.fetchedAt ?? 0,
          recent: options.recent ?? [],
        },
  );
};
/** As after the uploader's first drain: the state carries the session's git context. */
function withGit(path: string): void {
  const state = loadState(path);
  writeAtomic(path, { ...state, context: { ...state.context, git: GIT } });
}
const readCache = (directory: string) =>
  JSON.parse(readFileSync(recallCachePath(directory, REPO), "utf8")) as {
    v: number;
    sessions: number;
    fetchedAt: number;
    recent: RecentSession[];
  };
const readCounter = (path: string) =>
  JSON.parse(readFileSync(hintCounterPath(path), "utf8")) as Record<
    string,
    unknown
  >;
/** Answers the session list with `total.sessions` and items; everything else behaves like the fixture server. */
function listFetch(
  sessions: number,
  calls: URL[],
  status = 200,
  items: RecentSession[] = [],
) {
  const base = stubFetch(() => new Response(null, { status: 202 }));
  const fetcher: typeof fetch = (url, options) => {
    const target =
      url instanceof URL
        ? url
        : new URL(typeof url === "string" ? url : url.url);
    if (target.pathname === "/api/v1/sessions") {
      calls.push(target);
      return Promise.resolve(
        status === 200
          ? Response.json({
              items: items.map((item) => ({
                session_id: item.id,
                title: item.title,
                started_at: item.startedAt,
                branch: item.branch,
                reuse_count: item.reuseCount,
                by_teammate: item.byTeammate,
                message_count: item.messageCount,
                end_reason: item.endReason,
                files: item.files,
                user_email: "person@example.com",
                file_count: 3,
              })),
              cursor: null,
              total: { sessions, messages: 0 },
            })
          : new Response(null, { status }),
      );
    }
    return base(url, options);
  };
  return fetcher;
}
const wired = (status: "ok" | "placeholder" | "missing" = "ok") => {
  const home = mkdtempSync(join(tmpdir(), "agentcommons-recall-home-"));
  return wiredConfigHome(home, status);
};

describe("recall hint", () => {
  // @req R-CAP-20
  it("hints on the events HARNESSES flags: a session overview for Claude Code and Gemini, prompts for every shell harness, nothing for pi", () => {
    const hinted = Object.fromEntries(
      (Object.keys(HARNESSES) as CliHarness[]).map((name) => [
        name,
        Object.entries(HARNESSES[name].events)
          .filter(([, event]) => event.hint)
          .map(([event, definition]) => `${event}:${String(definition.hint)}`),
      ]),
    );
    expect(hinted).toEqual({
      claude: ["SessionStart:start", "UserPromptSubmit:prompt"],
      // Codex documents no SessionStart context output (Appendix A).
      codex: ["UserPromptSubmit:prompt"],
      gemini: ["SessionStart:start", "BeforeAgent:prompt"],
      pi: [],
    });
    expect(
      JSON.parse(hookContextOutput("BeforeAgent", "x")) as unknown,
    ).toEqual({
      hookSpecificOutput: {
        hookEventName: "BeforeAgent",
        additionalContext: "x",
      },
    });
    expect(recallHintText(REPO, 1)).toBe(
      "1 prior AgentCommons session touch github.com/acme/widgets; search them before changing code (search, get, sql over MCP).",
    );
  });

  // @req R-CAP-23
  it("gives the session overview once at session start, naming the newest sessions with their ids, and skips the first prompt's nudge", () => {
    const f = fixture({ config: wired() });
    cache(f.directory, 14, { recent });
    const start = (event = "SessionStart") =>
      f.hook({ hook_event_name: event });
    const path = start();
    const stdout = promptHint(
      f.directory,
      "claude",
      { ...f.event, hook_event_name: "SessionStart" },
      path,
      NOW,
    );
    // No git context in the state yet: the repository name comes from the working tree.
    expect(stdout).toBeNull();
    execFileSync("git", ["init", "-q"], { cwd: f.directory });
    execFileSync("git", ["remote", "add", "origin", GIT.remoteUrl], {
      cwd: f.directory,
    });
    expect(repositoryNameFromCwd(f.directory)).toBe(REPO);
    const nested = join(f.directory, "packages", "deep");
    mkdirSync(nested, { recursive: true });
    expect(repositoryNameFromCwd(nested)).toBe(REPO);
    const overview = promptHint(
      f.directory,
      "claude",
      { ...f.event, hook_event_name: "SessionStart" },
      path,
      NOW,
    );
    const expected = startHintText(REPO, 14, recent, NOW);
    expect(overview).toBe(hookContextOutput("SessionStart", expected));
    expect(expected).toBe(
      'AgentCommons has 14 indexed sessions on github.com/acme/widgets; worth opening: "Fix the inventory timeout in src/inventory.js" (1 day ago, get 01a08fd7-9907-72a3-9135-80162670d93a); "Retry payments the way the provider requires" (2 days ago, get 01a08fd7-9667-7163-a987-86201f0e0eb3); "Fake clock for the TTL cache test" (3 days ago, get 01a08fd7-93e7-7257-84df-b7f4f8ba44dd). Before changing code, search them for the test, file or error you were given (search over MCP), then read a hit with get and cite its session_id.',
    );
    // Once per session: a resume's SessionStart is silent.
    expect(
      promptHint(
        f.directory,
        "claude",
        { ...f.event, hook_event_name: "SessionStart", source: "resume" },
        path,
        NOW,
      ),
    ).toBeNull();
    // The first prompt after an overview adds nothing unless it matches a session.
    expect(
      promptHint(
        f.directory,
        "claude",
        {
          ...f.event,
          hook_event_name: "UserPromptSubmit",
          prompt: "Please tidy the README wording.",
        },
        path,
        NOW,
      ),
    ).toBeNull();
    expect(readCounter(path)).toMatchObject({
      v: 2,
      prompts: 1,
      lastHintPrompt: 0,
      startHinted: true,
      registration: "ok",
    });
  });

  // @req R-CAP-20
  it("names the cached sessions whose titles match the prompt, each once, and otherwise nudges on the first prompt and every 25th", () => {
    const f = fixture({ config: wired() });
    const path = f.hook({ hook_event_name: "Stop" });
    const prompt = (text: string, event = "UserPromptSubmit") =>
      promptHint(
        f.directory,
        "claude",
        { ...f.event, hook_event_name: event, prompt: text },
        path,
        NOW,
      );
    // No git context yet and no repository in the working tree: nothing, and no counter is started.
    expect(prompt("anything")).toBeNull();
    withGit(path);
    // A repository nobody has indexed says nothing.
    expect(prompt("anything")).toBeNull();
    cache(f.directory, 0);
    expect(prompt("anything")).toBeNull();
    cache(f.directory, 7, { recent });
    // A prompt that names a file another session worked on gets that session, not the count.
    const matched = prompt(
      "Inventory lookups time out during the nightly rebuild again; src/inventory.js has the wrong INVENTORY_TIMEOUT_MS.",
    );
    expect(matched).toBe(
      hookContextOutput(
        "UserPromptSubmit",
        matchedHintText(REPO, [recent[0] as RecentSession], NOW),
      ),
    );
    expect(matchedHintText(REPO, [recent[0] as RecentSession], NOW)).toBe(
      'AgentCommons: 1 prior session on github.com/acme/widgets match this prompt: "Fix the inventory timeout in src/inventory.js" (1 day ago, get 01a08fd7-9907-72a3-9135-80162670d93a). Read them with get before changing code; search finds more.',
    );
    // The same session is never named twice; a prompt on another topic is a plain nudge only when due.
    expect(prompt("The inventory timeout again, please.")).toBeNull();
    // Prompts 6 to 28 stay silent; the 25th prompt after the last hint (the 4th) nudges.
    for (let index = 0; index < RECALL_HINT_EVERY_PROMPTS - 2; index++)
      expect(prompt("Tidy the README wording.")).toBeNull();
    expect(prompt("Tidy the README wording.")).toBe(
      hookContextOutput("UserPromptSubmit", recallHintText(REPO, 7)),
    );
    // A branch name counts as a title word: the payments session matches its branch.
    expect(prompt("Look at the payments-retry branch.")).toBe(
      hookContextOutput(
        "UserPromptSubmit",
        matchedHintText(REPO, [recent[1] as RecentSession], NOW),
      ),
    );
    // Events without a flag never speak, whatever the cache holds.
    expect(prompt("inventory timeout", "Stop")).toBeNull();
    expect(prompt("inventory timeout", "PostToolUse")).toBeNull();
    // A v1 cache (count only) still nudges; it carries no sessions to match.
    const g = fixture({ config: wired() });
    const gPath = g.hook({ hook_event_name: "Stop" });
    withGit(gPath);
    cache(g.directory, 3, { v: 1 });
    expect(
      promptHint(
        g.directory,
        "claude",
        { ...g.event, hook_event_name: "UserPromptSubmit", prompt: "x" },
        gPath,
        NOW,
      ),
    ).toBe(hookContextOutput("UserPromptSubmit", recallHintText(REPO, 3)));
  });

  // @req R-CAP-20
  it("matches on two shared words or one shared identifier or path, ignoring stopwords", () => {
    const ids = (matches: RecentSession[]) => matches.map((m) => m.id);
    expect(ids(matchRecent("fix the inventory timeout", recent))).toEqual([
      recent[0]?.id,
    ]);
    expect(ids(matchRecent("src/inventory.js is wrong", recent))).toEqual([
      recent[0]?.id,
    ]);
    // One ordinary word is not enough; "the", "fix" and "test" carry no topic.
    expect(matchRecent("fix the test", recent)).toEqual([]);
    expect(matchRecent("inventory", recent)).toEqual([]);
    expect(ids(matchRecent("TTL cache flaky", recent))).toEqual([
      recent[2]?.id,
    ]);
    expect(matchRecent("", recent)).toEqual([]);
  });

  // @req R-CAP-24
  it("says once that the install needs repair, and nothing about searching, when the harness has no usable agentcommons entry", () => {
    for (const status of ["placeholder", "missing"] as const) {
      const f = fixture({ config: wired(status) });
      const home = f.config.installOptions?.configHome ?? "";
      expect(registrationStatus("claude", home)).toBe(status);
      expect(registrationStatus("gemini", home)).toBe(status);
      expect(registrationStatus("codex", home)).toBe(
        status === "missing" ? "missing" : "ok",
      );
      expect(registrationStatus("pi", home)).toBe("ok");
      const path = f.hook({ hook_event_name: "SessionStart" });
      withGit(path);
      cache(f.directory, 9, { recent });
      const expected = repairHintText(
        "claude",
        status,
        join(home, ".claude.json"),
        f.directory,
      );
      expect(expected).toContain(
        `node ${join(f.directory, "hook.js")} install`,
      );
      expect(expected).not.toMatch(/search them|search over MCP/);
      expect(
        promptHint(
          f.directory,
          "claude",
          { ...f.event, hook_event_name: "SessionStart" },
          path,
          NOW,
        ),
      ).toBe(hookContextOutput("SessionStart", expected));
      // Silent for the rest of the session: no repeat, no count, no matches.
      expect(
        promptHint(
          f.directory,
          "claude",
          {
            ...f.event,
            hook_event_name: "UserPromptSubmit",
            prompt: "src/inventory.js timeout",
          },
          path,
          NOW,
        ),
      ).toBeNull();
      expect(readCounter(path)).toMatchObject({
        repairHinted: true,
        registration: status,
      });
    }
    // A healthy entry, or a file too large to check inside the budget, hints as usual.
    const ok = wired();
    expect(registrationStatus("claude", ok.installOptions.configHome)).toBe(
      "ok",
    );
    writeFileSync(
      join(ok.installOptions.configHome, ".claude.json"),
      `{"mcpServers":{},"pad":"${"x".repeat(1024 * 1024)}"}`,
    );
    expect(registrationStatus("claude", ok.installOptions.configHome)).toBe(
      "unknown",
    );
  });

  // @req R-CAP-20
  it("reads the repository from a worktree's gitdir pointer and from the state's git context", () => {
    const f = fixture({ config: wired() });
    execFileSync("git", ["init", "-q"], { cwd: f.directory });
    execFileSync("git", ["remote", "add", "origin", GIT.remoteUrl], {
      cwd: f.directory,
    });
    writeFileSync(join(f.directory, "seed.txt"), "seed\n");
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
      { cwd: f.directory },
    );
    const worktree = join(f.directory, "wt");
    execFileSync("git", ["worktree", "add", "-q", worktree], {
      cwd: f.directory,
    });
    expect(repositoryNameFromCwd(worktree)).toBe(REPO);
    expect(repositoryNameFromCwd(tmpdir())).toBeNull();
    // Gemini's BeforeAgent speaks Gemini's event name from the state's git context.
    const gemini = fixture({
      harness: "gemini",
      transcriptName: "chat.json",
      initial: "{}",
      config: wired(),
    });
    const path = gemini.hook({ hook_event_name: "SessionStart" });
    withGit(path);
    cache(gemini.directory, 2);
    expect(
      promptHint(
        gemini.directory,
        "gemini",
        { ...gemini.event, hook_event_name: "BeforeAgent", prompt: "x" },
        path,
        NOW,
      ),
    ).toBe(hookContextOutput("BeforeAgent", recallHintText(REPO, 2)));
    const pi = fixture({ harness: "pi", config: wired() });
    const piPath = pi.hook({ hook_event_name: "session_start" });
    withGit(piPath);
    cache(pi.directory, 2);
    expect(
      promptHint(
        pi.directory,
        "pi",
        { ...pi.event, hook_event_name: "input" },
        piPath,
        NOW,
      ),
    ).toBeNull();
  });

  // @req R-CAP-19
  it("refreshes the repository's count and newest sessions at most every 15 minutes with one bounded list request", async () => {
    const f = fixture();
    const calls: URL[] = [];
    let now = 1_000_000;
    const options = { fetch: listFetch(3, calls, 200, recent), now: () => now };
    expect(await refreshRecallHint(f.directory, f.config, null, options)).toBe(
      "skipped",
    );
    expect(calls).toHaveLength(0);
    expect(await refreshRecallHint(f.directory, f.config, GIT, options)).toBe(
      "refreshed",
    );
    expect(calls).toHaveLength(1);
    const request = calls[0];
    if (!request) throw new Error("Missing request.");
    expect(request.origin).toBe(new URL(f.config.server).origin);
    expect(request.searchParams.get("limit")).toBe(String(RECALL_RECENT_LIMIT));
    expect(request.searchParams.get("roots_only")).toBe("true");
    expect(request.searchParams.get("recall")).toBe("true");
    expect(
      JSON.parse(request.searchParams.get("filters") ?? "") as unknown,
    ).toEqual({ repo_name: REPO });
    expect(readCache(f.directory)).toEqual({
      v: 2,
      repoName: REPO,
      sessions: 3,
      fetchedAt: now,
      recent,
    });
    // Inside the interval nothing is asked; after it, the data is fetched again.
    now += RECALL_REFRESH_MS - 1;
    expect(await refreshRecallHint(f.directory, f.config, GIT, options)).toBe(
      "current",
    );
    expect(calls).toHaveLength(1);
    now += 1;
    expect(await refreshRecallHint(f.directory, f.config, GIT, options)).toBe(
      "refreshed",
    );
    expect(calls).toHaveLength(2);
    // A failing server keeps the last data, is logged, and is not asked again before the interval.
    now += RECALL_REFRESH_MS;
    const failing = { fetch: listFetch(0, calls, 503), now: () => now };
    expect(await refreshRecallHint(f.directory, f.config, GIT, failing)).toBe(
      "skipped",
    );
    expect(readCache(f.directory)).toMatchObject({
      sessions: 3,
      fetchedAt: now,
      recent,
    });
    expect(readFileSync(join(f.directory, "hook.log"), "utf8")).toContain(
      "Recall hint skipped for github.com/acme/widgets",
    );
    expect(await refreshRecallHint(f.directory, f.config, GIT, failing)).toBe(
      "current",
    );
    expect(calls).toHaveLength(3);
    // Titles are bounded and cache files are keyed by the hashed repository name; the distill
    // fields ride along and are bounded (files ≤ 3 × 200 chars, end_reason ≤ 40).
    now += RECALL_REFRESH_MS;
    const long: RecentSession = {
      ...(recent[0] as RecentSession),
      title: "t".repeat(400),
      reuseCount: 9,
      byTeammate: true,
      messageCount: 42,
      endReason: "e".repeat(80),
      files: ["z".repeat(300), "b/b.ts", "c/c.ts", "d/d.ts"],
    };
    expect(
      await refreshRecallHint(f.directory, f.config, GIT, {
        fetch: listFetch(1, calls, 200, [long]),
        now: () => now,
      }),
    ).toBe("refreshed");
    const bounded = readCache(f.directory).recent[0];
    expect(bounded?.title).toHaveLength(100);
    expect(bounded?.reuseCount).toBe(9);
    expect(bounded?.byTeammate).toBe(true);
    expect(bounded?.messageCount).toBe(42);
    expect(bounded?.endReason).toHaveLength(40);
    expect(bounded?.files).toEqual(["z".repeat(200), "b/b.ts", "c/c.ts"]);
    expect(readdirSync(join(f.directory, "recall"))).toEqual([
      `${hash(REPO)}.json`,
    ]);
  });

  // @req R-CAP-19
  it("names the repository by the checkout's current origin, not by the remote the session state recorded", async () => {
    const f = fixture({ config: wired() });
    const root = mkdtempSync(join(tmpdir(), "agentcommons-recall-renamed-"));
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync(
      "git",
      ["remote", "add", "origin", "git@github.com:acme/renamed.git"],
      { cwd: root },
    );
    // The session began while `origin` was still `acme/old`; its state keeps that URL
    // (5,309 states on the machine this was found on still named a renamed remote).
    const stale = {
      root,
      remoteUrl: "git@github.com:acme/old.git",
      branch: "main",
      head: null,
    };
    const calls: URL[] = [];
    expect(
      await refreshRecallHint(f.directory, f.config, stale, {
        fetch: listFetch(4, calls, 200, recent),
        now: () => 5_000,
      }),
    ).toBe("refreshed");
    expect(
      JSON.parse(calls[0]?.searchParams.get("filters") ?? "") as unknown,
    ).toEqual({ repo_name: "github.com/acme/renamed" });
    expect(readdirSync(join(f.directory, "recall"))).toEqual([
      `${hash("github.com/acme/renamed")}.json`,
    ]);
    expect(
      JSON.parse(
        readFileSync(
          recallCachePath(f.directory, "github.com/acme/renamed"),
          "utf8",
        ),
      ) as unknown,
    ).toMatchObject({ repoName: "github.com/acme/renamed", sessions: 4 });
    // Hook mode resolves the same name from the state's root and finds that cache.
    const path = f.hook({ hook_event_name: "SessionStart" });
    const state = loadState(path);
    writeAtomic(path, { ...state, context: { ...state.context, git: stale } });
    expect(
      promptHint(
        f.directory,
        "claude",
        { ...f.event, hook_event_name: "UserPromptSubmit", prompt: "x" },
        path,
        NOW,
      ),
    ).toBe(
      hookContextOutput(
        "UserPromptSubmit",
        recallHintText("github.com/acme/renamed", 4),
      ),
    );
  });

  // @req R-CAP-19
  it("is refreshed by the uploader after a drain of a session inside a repository with a remote", async () => {
    const f = fixture({ config: wired() });
    execFileSync("git", ["init", "-q"], { cwd: f.directory });
    execFileSync("git", ["remote", "add", "origin", GIT.remoteUrl], {
      cwd: f.directory,
    });
    const path = f.hook({ hook_event_name: "SessionStart" });
    const calls: URL[] = [];
    // `guidance: false`: the repository write and its announcement are covered by guidance.test.ts.
    await upload(f.directory, SHIM, path, f.config, {
      fetch: listFetch(5, calls, 200, recent),
      sleep: () => Promise.resolve(),
      update: false,
      guidance: false,
    });
    expect(loadState(path).context.git?.remoteUrl).toBe(GIT.remoteUrl);
    expect(calls).toHaveLength(1);
    expect(readCache(f.directory).sessions).toBe(5);
    // The next prompt hook answers from the cache.
    expect(
      promptHint(
        f.directory,
        "claude",
        { ...f.event, hook_event_name: "UserPromptSubmit", prompt: "x" },
        path,
        NOW,
      ),
    ).toBe(hookContextOutput("UserPromptSubmit", recallHintText(REPO, 5)));
    // A second uploader run inside the interval sends no list request; `recall: false` never does.
    await upload(f.directory, SHIM, path, f.config, {
      fetch: listFetch(5, calls),
      sleep: () => Promise.resolve(),
      update: false,
      guidance: false,
    });
    await upload(f.directory, SHIM, path, f.config, {
      fetch: listFetch(5, calls),
      sleep: () => Promise.resolve(),
      update: false,
      recall: false,
      guidance: false,
    });
    expect(calls).toHaveLength(1);
  });

  // @req R-CAP-20 @req R-CAP-23 @req R-CAP-01
  it("the built hook prints the overview and the hint as its only stdout, exits zero and opens no connection", () => {
    const executable = resolve("packages/hook/dist/hook.js");
    const directory = mkdtempSync(
      join(tmpdir(), "agentcommons-recall-bundle-"),
    );
    configure(directory, {
      server: "http://127.0.0.1:1",
      key: "test",
      node: "/nonexistent-uploader",
      ...wiredConfigHome(directory, "ok", "http://127.0.0.1:1"),
    });
    const preloader = join(directory, "deny-network.cjs");
    writeFileSync(
      preloader,
      "globalThis.fetch=()=>{process.exit(91)};for(const module of ['node:http','node:https','node:net']){const m=require(module);for(const name of ['request','get','connect','createConnection'])if(m[name])m[name]=()=>{process.exit(91)}}",
    );
    const repository = join(directory, "repo");
    mkdirSync(repository);
    execFileSync("git", ["init", "-q"], { cwd: repository });
    execFileSync("git", ["remote", "add", "origin", GIT.remoteUrl], {
      cwd: repository,
    });
    const env = {
      ...process.env,
      AGENTCOMMONS_DIR: directory,
      NODE_OPTIONS: `--require=${preloader}`,
    };
    const run = (event: string, prompt?: string) => {
      const started = performance.now();
      const stdout = execFileSync(process.execPath, [executable, "claude"], {
        input: JSON.stringify({
          session_id: "bundle",
          cwd: repository,
          hook_event_name: event,
          ...(prompt ? { prompt } : {}),
        }),
        env,
        timeout: 5_000,
      }).toString();
      return { stdout, elapsed: performance.now() - started };
    };
    // An unindexed repository: silent at start and on the prompt.
    expect(run("SessionStart").stdout).toBe("");
    expect(run("UserPromptSubmit", "hello").stdout).toBe("");
    cache(directory, 4, { recent });
    // A second session in the same repository: overview at start, match on the prompt.
    const started = execFileSync(process.execPath, [executable, "claude"], {
      input: JSON.stringify({
        session_id: "bundle-2",
        cwd: repository,
        hook_event_name: "SessionStart",
      }),
      env,
      timeout: 5_000,
    }).toString();
    expect(JSON.parse(started) as unknown).toMatchObject({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: expect.stringContaining(
          "AgentCommons has 4 indexed sessions on github.com/acme/widgets; worth opening:",
        ) as unknown,
      },
    });
    const matched = execFileSync(process.execPath, [executable, "claude"], {
      input: JSON.stringify({
        session_id: "bundle-2",
        cwd: repository,
        hook_event_name: "UserPromptSubmit",
        prompt: "The TTL cache test is flaky again.",
      }),
      env,
      timeout: 5_000,
    }).toString();
    expect(JSON.parse(matched) as unknown).toMatchObject({
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: expect.stringContaining(
          `"Fake clock for the TTL cache test"`,
        ) as unknown,
      },
    });
    const silent = run("Stop");
    expect(silent.stdout).toBe("");
    expect(existsSync(join(directory, "hook.log"))).toBe(false);
    // The 150 ms budget is asserted by timing.perf.test.ts, which includes hinted events.
    console.log(`hook wall clock: silent Stop ${silent.elapsed.toFixed(1)} ms`);
  });

  // @req R-CAP-19 @req R-CAP-23
  it("distills reuse, teammate, top file and an unusual end into the overview, ranked by reuse", () => {
    const rich: RecentSession[] = [
      session({
        id: "s-new",
        title: "Newest, no signal",
        startedAt: "2026-09-10T12:00:00Z",
        branch: "main",
      }),
      session({
        id: "s-reused",
        title: "Cache TTL fix",
        startedAt: "2026-09-08T12:00:00Z",
        branch: "main",
        reuseCount: 5,
        files: ["src/cache.ts", "src/ttl.ts"],
      }),
      session({
        id: "s-mate",
        title: "Payments retry",
        startedAt: "2026-09-09T12:00:00Z",
        branch: "fix/pay",
        byTeammate: true,
        endReason: "error",
        files: ["src/pay.ts"],
      }),
    ];
    // The overview leads with reuse, then a teammate's work, then recency — not newest first.
    expect(rankRecent(rich).map((s) => s.id)).toEqual([
      "s-reused",
      "s-mate",
      "s-new",
    ]);
    const text = startHintText(REPO, 3, rich, NOW);
    expect(text).toContain(
      '"Cache TTL fix" (reused 5× · src/cache.ts · 3 days ago, get s-reused)',
    );
    expect(text).toContain(
      '"Payments retry" (teammate · src/pay.ts · ended: error · 2 days ago, get s-mate)',
    );
    expect(text).toContain('"Newest, no signal" (1 day ago, get s-new)');
    // A distilled preview also carries into the prompt-match hint.
    expect(matchedHintText(REPO, [rich[1] as RecentSession], NOW)).toContain(
      '"Cache TTL fix" (reused 5× · src/cache.ts · 3 days ago, get s-reused)',
    );
    // The before-edit line renders the same reuse/teammate/age marks in one sentence.
    expect(
      beforeEditHintText(
        "packages/hook/src/recall.ts",
        session({
          id: "x",
          title: "Prior recall work",
          startedAt: "2026-09-09T12:00:00Z",
          branch: "main",
          reuseCount: 3,
          byTeammate: true,
        }),
        NOW,
      ),
    ).toBe(
      'AgentCommons: a prior session worked on packages/hook/src/recall.ts: "Prior recall work" (reused 3× · teammate · 2 days ago). Read it with get x before editing.',
    );
    // An ordinary end reason is not surfaced.
    expect(
      startHintText(
        REPO,
        1,
        [
          session({
            id: "s",
            title: "t",
            startedAt: "2026-09-10T12:00:00Z",
            branch: "main",
            endReason: "completed",
          }),
        ],
        NOW,
      ),
    ).not.toContain("ended:");
  });

  // @req R-CAP-28
  it("surfaces one before-edit line for a file a prior session worked on, ranked and deduped, and is silent otherwise", () => {
    const f = fixture({ config: wired() });
    const repo = join(f.directory, "repo");
    mkdirSync(repo);
    execFileSync("git", ["init", "-q"], { cwd: repo });
    execFileSync("git", ["remote", "add", "origin", GIT.remoteUrl], {
      cwd: repo,
    });
    cache(f.directory, 8, {
      recent: [
        session({
          id: "s-a",
          title: "Fix inventory timeout",
          startedAt: "2026-09-10T12:00:00Z",
          branch: "main",
          reuseCount: 4,
          byTeammate: true,
          files: ["src/inventory.js"],
        }),
        session({
          id: "s-b",
          title: "Also touched inventory",
          startedAt: "2026-09-09T12:00:00Z",
          branch: "main",
          reuseCount: 1,
          files: ["src/inventory.js", "README.md"],
        }),
      ],
    });
    const pre = (
      tool: string,
      filePath: string | undefined,
      harness: CliHarness = "claude",
      sessionId = "edit-sess",
    ) =>
      preToolPayloadSchema.parse({
        session_id: sessionId,
        cwd: repo,
        hook_event_name: harness === "gemini" ? "BeforeTool" : "PreToolUse",
        tool_name: tool,
        ...(filePath === undefined
          ? {}
          : { tool_input: { file_path: filePath } }),
      });
    // Claude gives an absolute path; the stronger (more reused, teammate) session wins.
    expect(
      beforeEditHint(
        f.directory,
        "claude",
        pre("Edit", join(repo, "src/inventory.js")),
        NOW,
      ),
    ).toBe(
      'AgentCommons: a prior session worked on src/inventory.js: "Fix inventory timeout" (reused 4× · teammate · 1 day ago). Read it with get s-a before editing.',
    );
    // The dedup set names the edited file, repository-relative; a second edit of it is silent.
    const dedup = JSON.parse(
      readFileSync(
        beforeEditDedupPath(
          join(f.directory, "state", `claude-${hash("edit-sess")}.json`),
        ),
        "utf8",
      ),
    ) as { files: string[] };
    expect(dedup.files).toEqual(["src/inventory.js"]);
    expect(
      beforeEditHint(
        f.directory,
        "claude",
        pre("Write", join(repo, "src/inventory.js")),
        NOW,
      ),
    ).toBeNull();
    // A different file that only s-b touched fires once for s-b.
    expect(
      beforeEditHint(
        f.directory,
        "claude",
        pre("Write", join(repo, "README.md")),
        NOW,
      ),
    ).toBe(
      'AgentCommons: a prior session worked on README.md: "Also touched inventory" (reused 1× · 2 days ago). Read it with get s-b before editing.',
    );
    // Gemini gives a cwd-relative path; the same repository-relative file matches.
    expect(
      beforeEditHint(
        f.directory,
        "gemini",
        pre("replace", "src/inventory.js", "gemini", "gem-sess"),
        NOW,
      ),
    ).toContain(
      'worked on src/inventory.js: "Fix inventory timeout" (reused 4× · teammate',
    );
    // Silent, never throwing: a non-edit tool, a missing file, an unindexed file, a shell-only
    // harness, and a repository with no cache all return null.
    expect(
      beforeEditHint(
        f.directory,
        "claude",
        preToolPayloadSchema.parse({
          session_id: "b",
          cwd: repo,
          hook_event_name: "PreToolUse",
          tool_name: "Bash",
          tool_input: { command: "cat src/inventory.js" },
        }),
        NOW,
      ),
    ).toBeNull();
    expect(
      beforeEditHint(f.directory, "claude", pre("Edit", undefined), NOW),
    ).toBeNull();
    expect(
      beforeEditHint(
        f.directory,
        "claude",
        pre("Edit", join(repo, "src/never.ts")),
        NOW,
      ),
    ).toBeNull();
    // A same-basename file in another directory does not match (repo-relative equality, not
    // a loose suffix): a prior session's src/inventory.js is not lib/inventory.js.
    expect(
      beforeEditHint(
        f.directory,
        "claude",
        pre("Edit", join(repo, "lib/inventory.js"), "claude", "collide"),
        NOW,
      ),
    ).toBeNull();
    // Codex edits run through the shell tool, so its edit-tool set is empty: never fires.
    expect(
      beforeEditHint(
        f.directory,
        "codex",
        pre("apply_patch", join(repo, "src/inventory.js"), "codex", "codex-1"),
        NOW,
      ),
    ).toBeNull();
    const g = fixture({ config: wired() });
    expect(
      beforeEditHint(
        g.directory,
        "claude",
        pre("Edit", join(repo, "src/inventory.js"), "claude", "no-cache"),
        NOW,
      ),
    ).toBeNull();
  });

  // @req R-CAP-28
  it("writes the before-edit line on the informational context channel on an allowed edit, no decision field, and nothing without a match", () => {
    const f = fixture({ config: wired() });
    const repo = join(f.directory, "repo");
    mkdirSync(repo);
    execFileSync("git", ["init", "-q"], { cwd: repo });
    execFileSync("git", ["remote", "add", "origin", GIT.remoteUrl], {
      cwd: repo,
    });
    cache(f.directory, 3, {
      recent: [
        session({
          id: "s-a",
          title: "Fix inventory timeout",
          startedAt: "2026-09-10T12:00:00Z",
          branch: "main",
          reuseCount: 2,
          files: ["src/inventory.js"],
        }),
      ],
    });
    const emit = (
      harness: CliHarness,
      input: Record<string, unknown>,
    ): string => {
      const chunks: string[] = [];
      const spy = vi
        .spyOn(process.stdout, "write")
        .mockImplementation((chunk: string | Uint8Array) => {
          chunks.push(
            typeof chunk === "string" ? chunk : Buffer.from(chunk).toString(),
          );
          return true;
        });
      try {
        expect(
          enforcePreTool(f.directory, SHIM, f.config, harness, input),
        ).toBe(true);
      } finally {
        spy.mockRestore();
      }
      return chunks.join("");
    };
    // No policy cache: the call is allowed. Claude takes the line as model context only —
    // no user-facing systemMessage, no decision/permission field, so the allow is unchanged.
    const claudeOut = JSON.parse(
      emit("claude", {
        session_id: "wire",
        cwd: repo,
        hook_event_name: "PreToolUse",
        tool_name: "Edit",
        tool_input: { file_path: join(repo, "src/inventory.js") },
      }),
    ) as Record<string, unknown> & {
      hookSpecificOutput: { additionalContext: string };
    };
    expect(claudeOut.hookSpecificOutput.additionalContext).toContain(
      'worked on src/inventory.js: "Fix inventory timeout"',
    );
    expect(claudeOut.systemMessage).toBeUndefined();
    expect(claudeOut.decision).toBeUndefined();
    expect(claudeOut.hookSpecificOutput).not.toHaveProperty(
      "permissionDecision",
    );
    // Gemini has no pre-tool additionalContext, so its line rides systemMessage (its only
    // channel) with no decision field.
    const geminiOut = JSON.parse(
      emit("gemini", {
        session_id: "wire-g",
        cwd: repo,
        hook_event_name: "BeforeTool",
        tool_name: "replace",
        tool_input: { file_path: "src/inventory.js" },
      }),
    ) as Record<string, unknown> & { systemMessage: string };
    expect(geminiOut.systemMessage).toContain("worked on src/inventory.js");
    expect(geminiOut.decision).toBeUndefined();
    // An allowed non-edit tool still writes nothing.
    expect(
      emit("claude", {
        session_id: "wire",
        cwd: repo,
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: { command: "echo hi" },
      }),
    ).toBe("");
  });
});
