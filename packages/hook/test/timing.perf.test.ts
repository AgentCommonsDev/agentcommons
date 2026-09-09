import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { expect, it } from "vitest";
import { configure } from "../src/install.js";
import { HARNESSES } from "../src/harnesses.js";
import { hash } from "../src/files.js";
import { intentFileName, intentSchema, journalPath } from "../src/state.js";
const executable = resolve("packages/hook/dist/hook.js");
// @req R-CAP-01 @req R-INST-05
it("all hook events exit zero within 150 ms with a blackholed server and no hook-process network", async () => {
  const directory = mkdtempSync(join(tmpdir(), "agentcommons-fast-"));
  configure(directory, {
    server: "http://127.0.0.1:1",
    key: "test-credential",
    organizationId: "native-better-auth-org-id",
    credentialHash: hash("test-credential"),
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
