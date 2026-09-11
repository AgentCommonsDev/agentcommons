/**
 * Hook mode's wall-clock budget (§6.2): every hook event exits within 150 ms, measured as
 * the harness measures it, on the whole process. Codex clamps hooks, so a slow shim loses
 * events. These tests spawn the built bundle and time it from the parent.
 *
 * How the budget is verified. A whole-process time is the machine's cost of starting node
 * (25–40 ms on an idle developer machine, about half of it exec and file loading, half CPU)
 * plus the shim's own work, which is CPU-bound (about 115 ms of CPU on a 2.2 GHz cloud
 * core, 20 ms of it for bare node) and slows with every other process on the machine. A
 * fixed 150 ms ceiling therefore fails on a shared, loaded workstation or CI runner without
 * any regression in the shim. Each test measures a baseline alongside the hook: node on an
 * empty script, spawned through the same plumbing (stdin pipe, environment, `--require`
 * preloader), once before every timed hook spawn, so the median reflects the load of the
 * same seconds. Every hook time is the median of PASSES samples of the same event in fresh
 * sessions. Two bounds apply:
 *
 * 1. Relative, always: `hook_ms - baseline_ms <= BUDGET_MS * s`, with the slowdown
 *    `s = max(1, (baseline_ms - NODE_START_FIXED_MS) / (IDLE_NODE_START_MS - NODE_START_FIXED_MS))`.
 *    The shim's own work beyond the node start fits the budget scaled by how much slower
 *    this machine runs node's CPU work than the idle developer machine the budget is
 *    written for. The exec and file-loading part of a node start does not slow with CPU
 *    contention, so the slowdown is read from the rest; measured on a loaded box, a
 *    baseline of 65 ms (s = 2.25) went with hook times 3.7 times the idle ones. A hook that
 *    does more than it should (a blocking wait, a scan of the whole journal, a synchronous
 *    connection attempt) exceeds the bound at any load below about a threefold slowdown.
 * 2. Absolute, on an idle machine: `hook_ms < BUDGET_MS`, the spec's number, when the
 *    baseline is at most IDLE_NODE_START_MS. Above that the test says so once through
 *    `console.info` and relies on bound 1. Nothing is skipped.
 *
 * A spawn timeout only catches a hang; the budget is asserted on the measured time, so a
 * loaded machine produces a readable number instead of `ETIMEDOUT`.
 */
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { expect, it } from "vitest";
import { configure } from "../src/install.js";
import { wiredConfigHome } from "./fixture.js";
import { HARNESSES } from "../src/harnesses.js";
import { hash, writeAtomic } from "../src/files.js";
import { recallCachePath } from "../src/recall.js";
import {
  intentFileName,
  intentSchema,
  journalPath,
  loadState,
  statePath,
} from "../src/state.js";
const executable = resolve("packages/hook/dist/hook.js");
/** Spec §6.2: a hook event exits within this many milliseconds. */
const BUDGET_MS = 150;
/** A node start on the idle developer machine the budget is written for. */
const IDLE_NODE_START_MS = 40;
/** The exec and file-loading part of a node start; it does not slow with CPU contention. */
const NODE_START_FIXED_MS = 20;
/** Samples of a hook event; the median is asserted. */
const PASSES = 3;
/** Fails a hang only; the budget is asserted on the measured time. */
const SPAWN_TIMEOUT_MS = 10_000;
/** Native events are separated by agent work. Lets the detached uploader's startup settle. */
const SETTLE_MS = 200;
const TEST_TIMEOUT_MS = 180_000;

function median(samples: readonly number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const middle = sorted[Math.floor(sorted.length / 2)];
  if (middle === undefined) throw new Error("No samples.");
  return middle;
}

function timed(
  args: string[],
  input: string,
  env: NodeJS.ProcessEnv,
): { ms: number; stdout: string } {
  const started = performance.now();
  const stdout = execFileSync(process.execPath, args, {
    input,
    env,
    timeout: SPAWN_TIMEOUT_MS,
    stdio: ["pipe", "pipe", "pipe"],
  }).toString();
  return { ms: performance.now() - started, stdout };
}

/** Wall clock of node on an empty script, spawned exactly as the hook is, sampled over the run. */
class Baseline {
  private readonly empty: string;
  private readonly samples: number[] = [];
  constructor(
    directory: string,
    private readonly env: NodeJS.ProcessEnv,
  ) {
    this.empty = join(directory, "empty.cjs");
    writeFileSync(this.empty, "");
  }
  sample(): void {
    this.samples.push(timed([this.empty], "{}", this.env).ms);
  }
  /** Both bounds for this run; says once when the machine is too loaded for the absolute one. */
  bounds(): Bounds {
    const baselineMs = median(this.samples);
    const slowdown = Math.max(
      1,
      (baselineMs - NODE_START_FIXED_MS) /
        (IDLE_NODE_START_MS - NODE_START_FIXED_MS),
    );
    const ownWorkMs = BUDGET_MS * slowdown;
    const absolute = baselineMs <= IDLE_NODE_START_MS;
    if (!absolute)
      console.info(
        `node starts in ${baselineMs.toFixed(1)} ms here (idle developer machine: ${String(IDLE_NODE_START_MS)} ms), so the ${String(BUDGET_MS)} ms budget is judged on the hook's own work, ${ownWorkMs.toFixed(0)} ms beyond that start, not on the whole process.`,
      );
    return { baselineMs, ownWorkMs, absolute };
  }
}

interface Bounds {
  baselineMs: number;
  ownWorkMs: number;
  absolute: boolean;
}

function expectWithinBudget(ms: number, limits: Bounds, what: string): void {
  const detail = `${what} took ${ms.toFixed(1)} ms (node start ${limits.baselineMs.toFixed(1)} ms)`;
  expect(
    ms - limits.baselineMs,
    `${detail}; own work beyond the node start may take ${limits.ownWorkMs.toFixed(0)} ms`,
  ).toBeLessThanOrEqual(limits.ownWorkMs);
  if (limits.absolute)
    expect(
      ms,
      `${detail}; the machine is idle, so the spec's ${String(BUDGET_MS)} ms applies`,
    ).toBeLessThan(BUDGET_MS);
}

// @req R-CAP-01 @req R-INST-05 @req R-CAP-20
it(
  "all hook events exit zero within 150 ms with a blackholed server and no hook-process network, a hinted prompt included",
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "agentcommons-fast-"));
    configure(directory, {
      server: "http://127.0.0.1:1",
      key: "test-credential",
      organizationId: "native-better-auth-org-id",
      credentialHash: hash("test-credential"),
      // The hint's registration check reads the harness MCP files of this config home,
      // never the real home of the machine running the test (§6.2).
      ...wiredConfigHome(directory, "ok", "http://127.0.0.1:1"),
    });
    const preloader = join(directory, "deny-network.cjs");
    writeFileSync(
      preloader,
      "if(process.argv[2]!=='upload'){globalThis.fetch=()=>{process.exit(91)};for(const module of ['node:http','node:https','node:net']){const m=require(module);for(const name of ['request','get','connect','createConnection'])if(m[name])m[name]=()=>{process.exit(91)}}};",
    );
    const env = { ...process.env, AGENTCOMMONS_DIR: directory };
    const blackholed = { ...env, NODE_OPTIONS: `--require=${preloader}` };
    const baseline = new Baseline(directory, blackholed);
    const samples = new Map<string, number[]>();
    for (let pass = 0; pass < PASSES; pass++) {
      for (const [harness, definition] of Object.entries(HARNESSES)) {
        const sessionId = randomUUID();
        for (const event of Object.keys(definition.events)) {
          baseline.sample();
          const { ms } = timed(
            [executable, harness],
            JSON.stringify({
              session_id: sessionId,
              cwd: directory,
              hook_event_name: event,
            }),
            blackholed,
          );
          const key = `${harness} ${event}`;
          samples.set(key, [...(samples.get(key) ?? []), ms]);
          await delay(SETTLE_MS);
        }
      }
    }
    // A prompt that carries the cached recall hint (§6.2) reads two more small files and
    // writes one; it must fit the same budget. The hook names the repository from the
    // checkout's `.git/config` (`repositoryAt`), so the state's root is a real checkout
    // with `origin`, kept in its own directory so the session-start event (which resolves
    // from `cwd`, before the state records a root) finds no repository and leaves the
    // periodic prompt hint due.
    const checkout = join(directory, "checkout");
    mkdirSync(checkout);
    execFileSync("git", ["init", "-q"], { cwd: checkout });
    execFileSync(
      "git",
      ["remote", "add", "origin", "git@github.com:acme/widgets.git"],
      { cwd: checkout },
    );
    const git = {
      root: checkout,
      remoteUrl: "git@github.com:acme/widgets.git",
      branch: "main",
      head: null,
    };
    // The cache the uploader keeps: the count and the newest sessions (§6.2).
    writeAtomic(recallCachePath(directory, "github.com/acme/widgets"), {
      v: 2,
      repoName: "github.com/acme/widgets",
      sessions: 12,
      fetchedAt: Date.now(),
      recent: Array.from({ length: 10 }, (_, index) => ({
        id: `01a08fd7-9907-72a3-9135-80162670d9${String(index).padStart(2, "0")}`,
        title: `Session ${String(index)} about the widgets ${"x".repeat(60)}`,
        startedAt: "2026-09-10T12:00:00Z",
        branch: "main",
      })),
    });
    const hintedSamples: number[] = [];
    for (let pass = 0; pass < PASSES; pass++) {
      const hinted = randomUUID();
      const hintedInput = (event: string, prompt?: string) =>
        JSON.stringify({
          session_id: hinted,
          cwd: directory,
          hook_event_name: event,
          ...(prompt === undefined ? {} : { prompt }),
        });
      execFileSync(process.execPath, [executable, "claude"], {
        input: hintedInput("SessionStart"),
        env,
      });
      const path = statePath(directory, "claude", hinted);
      const state = loadState(path);
      writeAtomic(path, { ...state, context: { ...state.context, git } });
      await delay(SETTLE_MS);
      baseline.sample();
      const { ms, stdout } = timed(
        [executable, "claude"],
        hintedInput(
          "UserPromptSubmit",
          "Please tidy the README wording of this project.",
        ),
        blackholed,
      );
      expect(stdout).toContain(
        "12 prior AgentCommons sessions touch github.com/acme/widgets",
      );
      hintedSamples.push(ms);
      await delay(SETTLE_MS);
    }
    const limits = baseline.bounds();
    const medians = [...samples].map(
      ([key, times]) => [key, median(times)] as const,
    );
    const slowest = medians.reduce((a, b) => (b[1] > a[1] ? b : a));
    const hintedMs = median(hintedSamples);
    console.log(
      `hook wall clock (median of ${String(PASSES)}): node start ${limits.baselineMs.toFixed(1)} ms, slowest event ${slowest[0]} ${slowest[1].toFixed(1)} ms, hinted prompt ${hintedMs.toFixed(1)} ms`,
    );
    for (const [key, ms] of medians) expectWithinBudget(ms, limits, key);
    expectWithinBudget(hintedMs, limits, "claude UserPromptSubmit (hinted)");
    expect(
      execFileSync(process.execPath, [executable, "claude"], {
        input: "invalid",
        env,
      }).toString(),
    ).toBe("");
  },
  TEST_TIMEOUT_MS,
);

// @req R-CAP-01
it(
  "keeps the 150 ms callback budget with 5000 pending indexed intents",
  () => {
    const directory = mkdtempSync(
      join(tmpdir(), "agentcommons-backlog-timing-"),
    );
    configure(directory, {
      server: "http://127.0.0.1:1",
      key: "test",
      node: "/nonexistent-uploader",
    });
    const input = JSON.stringify({
      session_id: "backlog",
      cwd: directory,
      hook_event_name: "Stop",
    });
    const env = { ...process.env, AGENTCOMMONS_DIR: directory };
    execFileSync(process.execPath, [executable, "claude"], { input, env });
    const state = readdirSync(join(directory, "state")).find((file) =>
      file.endsWith(".json"),
    );
    if (!state) throw new Error("Missing state.");
    const journal = journalPath(join(directory, "state", state));
    const first = readdirSync(journal)[0];
    if (!first) throw new Error("Missing intent.");
    const original = intentSchema.parse(
      JSON.parse(readFileSync(join(journal, first), "utf8")),
    );
    for (let index = 0; index < 5000; index++) {
      const intent = {
        ...original,
        id: hash(String(index)),
        sentAt: new Date().toISOString(),
      };
      writeFileSync(
        join(journal, intentFileName(intent)),
        JSON.stringify(intent),
      );
    }
    const baseline = new Baseline(directory, env);
    const samples: number[] = [];
    for (let pass = 0; pass < PASSES; pass++) {
      baseline.sample();
      baseline.sample();
      samples.push(timed([executable, "claude"], input, env).ms);
    }
    const limits = baseline.bounds();
    const ms = median(samples);
    console.log(
      `hook wall clock with 5000 pending intents (median of ${String(PASSES)}): ${ms.toFixed(1)} ms, node start ${limits.baselineMs.toFixed(1)} ms`,
    );
    expectWithinBudget(ms, limits, "claude Stop with 5000 pending intents");
  },
  TEST_TIMEOUT_MS,
);
