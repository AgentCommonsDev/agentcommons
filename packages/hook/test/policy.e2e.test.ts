import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { once } from "node:events";
import { mkdtempSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { hash, writeAtomic } from "../src/files.js";
import { configure } from "../src/install.js";
import { policyCachePath } from "../src/policy.js";

const executable = resolve("packages/hook/dist/hook.js");
const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((r) => {
      server.close(() => {
        r();
      });
    });
  }
});
function body(request: IncomingMessage): Promise<string> {
  return new Promise((resolvePromise) => {
    let text = "";
    request.on("data", (chunk: Buffer) => (text += chunk.toString()));
    request.on("end", () => {
      resolvePromise(text);
    });
  });
}
/** A server that answers everything the detached uploader touches and records the violations. */
async function stub(violations: unknown[]): Promise<string> {
  const server = createServer((request, response) => {
    if (request.url === "/hook/manifest.json") {
      response.end(
        JSON.stringify({ version: "0.1.0-test", sha256: "x", url: "/x" }),
      );
      return;
    }
    if (request.method === "GET" && request.url === "/api/v1/tool-policy") {
      response.end(JSON.stringify({ enabled: false, rules: [], revision: 0 }));
      return;
    }
    if (request.url === "/api/v1/tool-policy/violations") {
      void body(request).then((text) => {
        try {
          const parsed = JSON.parse(text) as { violations?: unknown[] };
          for (const v of parsed.violations ?? []) violations.push(v);
        } catch {
          /* ignore */
        }
        response.statusCode = 202;
        response.end(JSON.stringify({ accepted: 1 }));
      });
      return;
    }
    response.statusCode = request.method === "POST" ? 202 : 200;
    response.end(
      request.url === "/api/v1/me"
        ? JSON.stringify({ organization: { id: "org" } })
        : JSON.stringify({ accepted: 1 }),
    );
  });
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No address.");
  return `http://127.0.0.1:${String(address.port)}`;
}
function run(
  env: NodeJS.ProcessEnv,
  input: string,
): Promise<{ code: number | null; stdout: string }> {
  return new Promise((resolvePromise, reject) => {
    const c = spawn(process.execPath, [executable, "claude"], {
      env,
      stdio: ["pipe", "pipe", "ignore"],
    });
    let stdout = "";
    c.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    c.on("error", reject);
    c.on("exit", (code) => {
      resolvePromise({ code, stdout });
    });
    c.stdin.end(input);
  });
}
const preTool = (command: string) =>
  JSON.stringify({
    session_id: randomUUID(),
    cwd: "/tmp/repo",
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command },
    tool_use_id: "tool-1",
  });

// @req R-POL-09 @req R-POL-11
it("enforces a cached policy through the built bundle and forwards the blocked decision", async () => {
  const violations: unknown[] = [];
  const server = await stub(violations);
  const directory = mkdtempSync(join(tmpdir(), "agentcommons-policy-e2e-"));
  configure(directory, {
    server,
    key: "test",
    organizationId: "019939c0-0000-7000-8000-000000000001",
    credentialHash: hash("test"),
  });
  writeAtomic(policyCachePath(directory), {
    v: 1,
    fetchedAt: Date.now(),
    revision: 1,
    policy: {
      enabled: true,
      rules: [
        {
          id: "no-touch",
          description: "Blocked by the built-bundle e2e policy.",
          harnesses: [],
          tool: "*",
          command_patterns: [{ kind: "substring", value: "DENYME" }],
          action: "deny",
          severity: "high",
        },
      ],
    },
  });
  const env = {
    ...process.env,
    AGENTCOMMONS_DIR: directory,
    AGENTCOMMONS_SERVER: server,
  };

  // Deny: the one block shape on stdout, exit 0 (the fail-open harnesses never see a crash).
  const deny = await run(env, preTool("echo DENYME"));
  expect(deny.code).toBe(0);
  expect(JSON.parse(deny.stdout)).toEqual({
    decision: "block",
    reason: "Blocked by the built-bundle e2e policy.",
  });

  // Allow: silent, exit 0.
  const allow = await run(env, preTool("echo fine"));
  expect(allow.code).toBe(0);
  expect(allow.stdout).toBe("");

  // The detached uploader forwards the blocked decision to the violations endpoint.
  for (let i = 0; i < 100 && violations.length === 0; i++) await sleep(100);
  expect(violations.length).toBeGreaterThanOrEqual(1);
  expect(violations[0]).toMatchObject({
    tool: "Bash",
    command: "echo DENYME",
    rule_id: "no-touch",
    decision: "deny",
    severity: "high",
  });
}, 20_000);
