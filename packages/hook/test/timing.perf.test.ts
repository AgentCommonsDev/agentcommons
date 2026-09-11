import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
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
// @req R-CAP-01 @req R-INST-05 @req R-CAP-20
it("all hook events exit zero within 150 ms with a blackholed server and no hook-process network, a hinted prompt included", async () => {
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
  const times: number[] = [];
  for (const [harness, definition] of Object.entries(HARNESSES)) {
    const sessionId = randomUUID();
    for (const event of Object.keys(definition.events)) {
      const started = performance.now();
      execFileSync(process.execPath, [executable, harness], {
        input: JSON.stringify({
          session_id: sessionId,
          cwd: directory,
          hook_event_name: event,
        }),
        env: {
          ...process.env,
          AGENTCOMMONS_DIR: directory,
          NODE_OPTIONS: `--require=${preloader}`,
        },
        timeout: 150,
        stdio: ["pipe", "pipe", "pipe"],
      });
      times.push(performance.now() - started);
      // Native events are separated by agent work. Let detached upload startup settle.
      await delay(200);
    }
  }
  // A prompt that carries the cached recall hint (§6.2) reads two more small files and
  // writes one; it must fit the same budget.
  const hinted = randomUUID();
  const hintedInput = (event: string) =>
    JSON.stringify({
      session_id: hinted,
      cwd: directory,
      hook_event_name: event,
    });
  const env = { ...process.env, AGENTCOMMONS_DIR: directory };
  execFileSync(process.execPath, [executable, "claude"], {
    input: hintedInput("SessionStart"),
    env,
  });
  const path = statePath(directory, "claude", hinted);
  const state = loadState(path);
  // The hook names the repository from the checkout's `.git/config`, so the root is a
  // real checkout with `origin`; the state's recorded URL is never what it reads.
  execFileSync("git", ["init", "-q"], { cwd: directory });
  execFileSync(
    "git",
    ["remote", "add", "origin", "git@github.com:acme/widgets.git"],
    { cwd: directory },
  );
  const git = {
    root: directory,
    remoteUrl: "git@github.com:acme/widgets.git",
    branch: "main",
    head: null,
  };
  writeAtomic(path, { ...state, context: { ...state.context, git } });
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
  await delay(200);
  const started = performance.now();
  const stdout = execFileSync(process.execPath, [executable, "claude"], {
    input: JSON.stringify({
      session_id: hinted,
      cwd: directory,
      hook_event_name: "UserPromptSubmit",
      prompt: "Please tidy the README wording of this project.",
    }),
    env: { ...env, NODE_OPTIONS: `--require=${preloader}` },
    timeout: 150,
  }).toString();
  const hintedMs = performance.now() - started;
  times.push(hintedMs);
  expect(stdout).toContain(
    "12 prior AgentCommons sessions touch github.com/acme/widgets",
  );
  console.log(
    `hook wall clock: max ${Math.max(...times).toFixed(1)} ms, hinted prompt ${hintedMs.toFixed(1)} ms`,
  );
  expect(Math.max(...times)).toBeLessThan(150);
  expect(
    execFileSync(process.execPath, [executable, "claude"], {
      input: "invalid",
      env: { ...process.env, AGENTCOMMONS_DIR: directory },
    }).toString(),
  ).toBe("");
});

// @req R-CAP-01
it("keeps the 150 ms callback budget with 5000 pending indexed intents", () => {
  const directory = mkdtempSync(join(tmpdir(), "agentcommons-backlog-timing-"));
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
  const started = performance.now();
  execFileSync(process.execPath, [executable, "claude"], {
    input,
    env,
    timeout: 150,
  });
  expect(performance.now() - started).toBeLessThan(150);
});
