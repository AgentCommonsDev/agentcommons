/**
 * Wall-clock distribution of the built hook on hinted events (ADR 0070): SessionStart
 * with a cached overview, UserPromptSubmit with a matching prompt, a silent Stop. Runs the
 * bundle N times per event in a fresh installation with an isolated config home and prints
 * p50 and p95. Not part of CI (timing depends on the machine).
 *
 *   node --import tsx scripts/recall-bench/hook-timing.ts [--runs 40] [--bundle packages/hook/dist/hook.js]
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { configure } from "../../packages/hook/src/install.js";
import { recallCachePath } from "../../packages/hook/src/recall.js";
import { writeAtomic } from "../../packages/hook/src/files.js";
import { wiredConfigHome } from "../../packages/hook/test/fixture.js";

function argument(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return (index >= 0 ? process.argv[index + 1] : undefined) ?? fallback;
}
const runs = Number(argument("runs", "40"));
const bundle = resolve(argument("bundle", "packages/hook/dist/hook.js"));
const directory = mkdtempSync(join(tmpdir(), "agentcommons-hook-timing-"));
configure(directory, {
  server: "http://127.0.0.1:1",
  key: "test",
  node: "/nonexistent-uploader",
  ...wiredConfigHome(directory, "ok", "http://127.0.0.1:1"),
});
const repository = join(directory, "repo");
mkdirSync(repository);
execFileSync("git", ["init", "-q"], { cwd: repository });
execFileSync(
  "git",
  ["remote", "add", "origin", "git@github.com:acme/widgets.git"],
  { cwd: repository },
);
writeAtomic(recallCachePath(directory, "github.com/acme/widgets"), {
  v: 2,
  repoName: "github.com/acme/widgets",
  sessions: 12,
  fetchedAt: Date.now(),
  recent: Array.from({ length: 10 }, (_, index) => ({
    id: `01a08fd7-9907-72a3-9135-80162670d9${String(index).padStart(2, "0")}`,
    title: `Session ${String(index)} fixing src/module${String(index)}.js after the timeout regression`,
    startedAt: "2026-09-10T12:00:00Z",
    branch: "main",
  })),
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
function time(event: string, prompt: string | undefined, session: string) {
  const started = performance.now();
  const stdout = execFileSync(process.execPath, [bundle, "claude"], {
    input: JSON.stringify({
      session_id: session,
      cwd: repository,
      hook_event_name: event,
      ...(prompt ? { prompt } : {}),
    }),
    env,
    timeout: 5_000,
  }).toString();
  return { ms: performance.now() - started, spoke: stdout.length > 0 };
}
const percentile = (values: number[], share: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return (
    sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))] ?? 0
  );
};
const cases: [string, string | undefined][] = [
  ["SessionStart", undefined],
  [
    "UserPromptSubmit",
    "src/module3.js is timing out again after the regression",
  ],
  ["Stop", undefined],
];
for (const [event, prompt] of cases) {
  const samples: number[] = [];
  let spoke = 0;
  for (let index = 0; index < runs; index++) {
    // Every run is a fresh session, so the overview and the match fire each time.
    const result = time(event, prompt, `timing-${event}-${String(index)}`);
    samples.push(result.ms);
    if (result.spoke) spoke++;
  }
  console.log(
    `${event}: p50 ${percentile(samples, 0.5).toFixed(1)} ms, p95 ${percentile(samples, 0.95).toFixed(1)} ms, max ${Math.max(...samples).toFixed(1)} ms, spoke ${String(spoke)}/${String(runs)}`,
  );
}
