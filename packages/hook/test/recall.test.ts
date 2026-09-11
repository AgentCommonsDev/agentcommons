import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { hash, writeAtomic } from "../src/files.js";
import { HARNESSES, type CliHarness } from "../src/harnesses.js";
import { configure } from "../src/install.js";
import {
  RECALL_HINT_EVERY_PROMPTS,
  RECALL_REFRESH_MS,
  hintCounterPath,
  hookContextOutput,
  promptHint,
  recallCachePath,
  recallHintText,
  refreshRecallHint,
} from "../src/recall.js";
import { loadState } from "../src/state.js";
import { upload } from "../src/upload.js";
import { SHIM, fixture, stubFetch } from "./fixture.js";

const GIT = {
  root: "/repo",
  remoteUrl: "git@github.com:acme/widgets.git",
  branch: "main",
  head: null,
};
const REPO = "github.com/acme/widgets";
const cache = (directory: string, sessions: number, fetchedAt = 0) => {
  writeAtomic(recallCachePath(directory, REPO), {
    v: 1,
    repoName: REPO,
    sessions,
    fetchedAt,
  });
};
/** As after the uploader's first drain: the state carries the session's git context. */
function withGit(path: string): void {
  const state = loadState(path);
  writeAtomic(path, { ...state, context: { ...state.context, git: GIT } });
}
const readCache = (directory: string) =>
  JSON.parse(readFileSync(recallCachePath(directory, REPO), "utf8")) as {
    sessions: number;
    fetchedAt: number;
  };
/** Answers the session list with `total.sessions`; everything else behaves like the fixture server. */
function listFetch(sessions: number, calls: URL[], status = 200) {
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
              items: [],
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

describe("recall hint", () => {
  // @req R-CAP-20
  it("hints only on events HARNESSES flags, with the harness's own event name", () => {
    const hinted = Object.fromEntries(
      (Object.keys(HARNESSES) as CliHarness[]).map((name) => [
        name,
        Object.entries(HARNESSES[name].events)
          .filter(([, event]) => event.hint)
          .map(([event]) => event),
      ]),
    );
    expect(hinted).toEqual({
      claude: ["UserPromptSubmit"],
      codex: ["UserPromptSubmit"],
      gemini: ["BeforeAgent"],
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

  // @req R-CAP-20
  it("injects the cached count once, then every 25 prompts, from the cache alone", () => {
    const f = fixture();
    const path = f.hook({ hook_event_name: "SessionStart" });
    const prompt = (event = "UserPromptSubmit") =>
      promptHint(
        f.directory,
        "claude",
        { ...f.event, hook_event_name: event },
        path,
      );
    // No git context yet (the uploader records it): nothing, and no counter is started.
    expect(prompt()).toBeNull();
    withGit(path);
    // A repository nobody has indexed says nothing.
    expect(prompt()).toBeNull();
    cache(f.directory, 0);
    expect(prompt()).toBeNull();
    expect(existsSync(hintCounterPath(path))).toBe(false);
    cache(f.directory, 7);
    expect(prompt()).toBe(
      hookContextOutput("UserPromptSubmit", recallHintText(REPO, 7)),
    );
    // Rate limit: the next prompts are silent until the interval elapses.
    for (let index = 1; index < RECALL_HINT_EVERY_PROMPTS; index++)
      expect(prompt()).toBeNull();
    cache(f.directory, 9);
    expect(prompt()).toBe(
      hookContextOutput("UserPromptSubmit", recallHintText(REPO, 9)),
    );
    expect(
      JSON.parse(readFileSync(hintCounterPath(path), "utf8")) as unknown,
    ).toEqual({
      v: 1,
      prompts: RECALL_HINT_EVERY_PROMPTS + 1,
      hintedAt: RECALL_HINT_EVERY_PROMPTS + 1,
    });
    // Events without the flag never speak, whatever the cache holds.
    expect(prompt("Stop")).toBeNull();
    expect(prompt("PostToolUse")).toBeNull();
  });

  // @req R-CAP-20
  it("speaks Gemini's event name and stays silent for pi's bridge events", () => {
    const gemini = fixture({
      harness: "gemini",
      transcriptName: "chat.json",
      initial: "{}",
    });
    const path = gemini.hook({ hook_event_name: "SessionStart" });
    withGit(path);
    cache(gemini.directory, 2);
    expect(
      promptHint(
        gemini.directory,
        "gemini",
        { ...gemini.event, hook_event_name: "BeforeAgent" },
        path,
      ),
    ).toBe(hookContextOutput("BeforeAgent", recallHintText(REPO, 2)));
    const pi = fixture({ harness: "pi" });
    const piPath = pi.hook({ hook_event_name: "session_start" });
    withGit(piPath);
    cache(pi.directory, 2);
    expect(
      promptHint(
        pi.directory,
        "pi",
        { ...pi.event, hook_event_name: "input" },
        piPath,
      ),
    ).toBeNull();
  });

  // @req R-CAP-19
  it("refreshes the repository's count at most every 15 minutes with one bounded list request", async () => {
    const f = fixture();
    const calls: URL[] = [];
    let now = 1_000_000;
    const options = { fetch: listFetch(3, calls), now: () => now };
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
    expect(request.searchParams.get("limit")).toBe("1");
    expect(
      JSON.parse(request.searchParams.get("filters") ?? "") as unknown,
    ).toEqual({ repo_name: REPO });
    expect(readCache(f.directory)).toEqual({
      v: 1,
      repoName: REPO,
      sessions: 3,
      fetchedAt: now,
    });
    // Inside the interval nothing is asked; after it, the count is fetched again.
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
    // A failing server keeps the last count, is logged, and is not asked again before the interval.
    now += RECALL_REFRESH_MS;
    const failing = { fetch: listFetch(0, calls, 503), now: () => now };
    expect(await refreshRecallHint(f.directory, f.config, GIT, failing)).toBe(
      "skipped",
    );
    expect(readCache(f.directory)).toMatchObject({
      sessions: 3,
      fetchedAt: now,
    });
    expect(readFileSync(join(f.directory, "hook.log"), "utf8")).toContain(
      "Recall hint skipped for github.com/acme/widgets",
    );
    expect(await refreshRecallHint(f.directory, f.config, GIT, failing)).toBe(
      "current",
    );
    expect(calls).toHaveLength(3);
    // Cache files are keyed by the hashed repository name under the data directory.
    expect(readdirSync(join(f.directory, "recall"))).toEqual([
      `${hash(REPO)}.json`,
    ]);
  });

  // @req R-CAP-19
  it("is refreshed by the uploader after a drain of a session inside a repository with a remote", async () => {
    const f = fixture();
    execFileSync("git", ["init", "-q"], { cwd: f.directory });
    execFileSync("git", ["remote", "add", "origin", GIT.remoteUrl], {
      cwd: f.directory,
    });
    const path = f.hook({ hook_event_name: "SessionStart" });
    const calls: URL[] = [];
    await upload(f.directory, SHIM, path, f.config, {
      fetch: listFetch(5, calls),
      sleep: () => Promise.resolve(),
      update: false,
    });
    expect(loadState(path).context.git?.remoteUrl).toBe(GIT.remoteUrl);
    expect(calls).toHaveLength(1);
    expect(readCache(f.directory).sessions).toBe(5);
    // The next prompt hook answers from the cache.
    expect(
      promptHint(
        f.directory,
        "claude",
        { ...f.event, hook_event_name: "UserPromptSubmit" },
        path,
      ),
    ).toBe(hookContextOutput("UserPromptSubmit", recallHintText(REPO, 5)));
    // A second uploader run inside the interval sends no list request; `recall: false` never does.
    await upload(f.directory, SHIM, path, f.config, {
      fetch: listFetch(5, calls),
      sleep: () => Promise.resolve(),
      update: false,
    });
    await upload(f.directory, SHIM, path, f.config, {
      fetch: listFetch(5, calls),
      sleep: () => Promise.resolve(),
      update: false,
      recall: false,
    });
    expect(calls).toHaveLength(1);
  });

  // @req R-CAP-20 @req R-CAP-01
  it("the built hook prints the hint as its only stdout, exits zero and opens no connection", () => {
    const executable = resolve("packages/hook/dist/hook.js");
    const directory = mkdtempSync(
      join(tmpdir(), "agentcommons-recall-bundle-"),
    );
    configure(directory, {
      server: "http://127.0.0.1:1",
      key: "test",
      node: "/nonexistent-uploader",
    });
    const preloader = join(directory, "deny-network.cjs");
    writeFileSync(
      preloader,
      "globalThis.fetch=()=>{process.exit(91)};for(const module of ['node:http','node:https','node:net']){const m=require(module);for(const name of ['request','get','connect','createConnection'])if(m[name])m[name]=()=>{process.exit(91)}}",
    );
    const env = {
      ...process.env,
      AGENTCOMMONS_DIR: directory,
      NODE_OPTIONS: `--require=${preloader}`,
    };
    const run = (event: string) => {
      const started = performance.now();
      const stdout = execFileSync(process.execPath, [executable, "claude"], {
        input: JSON.stringify({
          session_id: "bundle",
          cwd: directory,
          hook_event_name: event,
        }),
        env,
        timeout: 5_000,
      }).toString();
      return { stdout, elapsed: performance.now() - started };
    };
    expect(run("SessionStart").stdout).toBe("");
    const state = readdirSync(join(directory, "state")).find((file) =>
      file.endsWith(".json"),
    );
    if (!state) throw new Error("Missing state.");
    withGit(join(directory, "state", state));
    cache(directory, 4);
    const first = run("UserPromptSubmit");
    expect(JSON.parse(first.stdout) as unknown).toEqual({
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: recallHintText(REPO, 4),
      },
    });
    expect(run("UserPromptSubmit").stdout).toBe("");
    const silent = run("Stop");
    expect(silent.stdout).toBe("");
    // The 150 ms budget is asserted by timing.perf.test.ts, which includes a hinted prompt.
    console.log(
      `hook wall clock: hinted UserPromptSubmit ${first.elapsed.toFixed(1)} ms, silent Stop ${silent.elapsed.toFixed(1)} ms`,
    );
  });
});
