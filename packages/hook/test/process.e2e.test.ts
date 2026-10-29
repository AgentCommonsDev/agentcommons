import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  statSync,
  mkdirSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { configure } from "../src/install.js";
import { recordHook } from "../src/hook.js";
import { journalPath, loadState, ownerPath } from "../src/state.js";
import { upload } from "../src/upload.js";
import {
  ingestEnvelopeSchema,
  type IngestEnvelope,
} from "@agentcommons/core/schemas/ingest";

const servers: Server[] = [];
const executable = resolve("packages/hook/dist/hook.js");
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) =>
      server.close(() => {
        resolve();
      }),
    );
  }
});
async function listen(server: Server): Promise<string> {
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No TCP address.");
  return `http://127.0.0.1:${String(address.port)}`;
}
function run(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  input = "",
): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      resolve({ code, output });
    });
    child.stdin.end(input);
  });
}
// @req R-CAP-04 @req R-CAP-05
it("recovers after actual SIGKILL before send, after acceptance, and after local acknowledgment", async () => {
  for (const point of ["persisted", "accepted", "acknowledged"]) {
    const received: IngestEnvelope[] = [];
    const server = await listen(
      createServer((request, response) => {
        if (request.url === "/api/v1/me") {
          response.end(
            JSON.stringify({
              organization: { id: "native-better-auth-org-id" },
            }),
          );
          return;
        }
        // The uploader's hourly self-update check reads the manifest; the served bundle
        // is the one under test, so the shim stays current and nothing is downloaded.
        if (request.method === "GET") {
          if (request.url === "/hook/manifest.json") {
            response.end(
              readFileSync(resolve("apps/api/public/hook/manifest.json")),
            );
            return;
          }
          response.writeHead(404);
          response.end();
          return;
        }
        const chunks: Buffer[] = [];
        request.on("data", (chunk: Buffer) => chunks.push(chunk));
        request.on("end", () => {
          received.push(
            ingestEnvelopeSchema.parse(
              JSON.parse(Buffer.concat(chunks).toString()) as unknown,
            ),
          );
          response.writeHead(202);
          response.end();
        });
      }),
    );
    const directory = mkdtempSync(join(tmpdir(), "agentcommons-kill-"));
    const config = configure(directory, { server, key: "test-credential" });
    const transcript = join(directory, "source.jsonl");
    writeFileSync(transcript, '{"uuid":"first"}\n');
    const path = recordHook(
      directory,
      "/nonexistent-test-shim.js",
      config,
      "claude",
      {
        session_id: randomUUID(),
        transcript_path: transcript,
        cwd: directory,
        hook_event_name: "Stop",
      },
    );
    if (!path) throw new Error("Missing state.");
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        resolve("packages/hook/test/kill-worker.ts"),
        directory,
        path,
        point,
      ],
      { stdio: ["ignore", "pipe", "pipe", "ipc"] },
    );
    await Promise.race([
      once(child, "message"),
      once(child, "exit").then(() => {
        throw new Error("Worker exited before checkpoint.");
      }),
    ]);
    const before = loadState(path);
    child.kill("SIGKILL");
    await once(child, "exit");
    await upload(directory, executable, path, config, { sweep: false });
    const after = loadState(path);
    expect(after.pending).toBeNull();
    expect(after.cleanup).toEqual({ files: [], intents: [] });
    expect(readdirSync(join(directory, "spool"))).toEqual([]);
    expect(readdirSync(journalPath(path))).toEqual([]);
    expect(after.ackedCursor).toEqual({
      kind: "jsonl",
      offset: statSync(transcript).size,
    });
    expect(new Set(received.map((body) => body.batchId)).size).toBe(1);
    expect(received).toHaveLength(point === "accepted" ? 2 : 1);
    if (point !== "acknowledged")
      expect(before.ackedCursor).toEqual({ kind: "jsonl", offset: 0 });
  }
});
// @req R-INST-01 @req R-INST-02 @req R-INST-03 @req R-INST-04 @req R-INST-05 @req R-INST-06 @req R-INST-09 @req R-INST-10
it("installs verified artifacts, preserves identity, rejects bad checksums, and uninstalls offline", async () => {
  let corrupt = false;
  let requests = 0;
  const server = await listen(
    createServer((request, response) => {
      requests++;
      if (request.url === "/api/v1/me") {
        response.writeHead(
          request.headers.authorization === "Bearer test-credential"
            ? 200
            : 401,
        );
        response.end(
          JSON.stringify({
            organization: { id: "native-better-auth-org-id" },
          }),
        );
        return;
      }
      if (!request.url?.startsWith("/hook/") || request.url.includes("..")) {
        response.writeHead(404);
        response.end();
        return;
      }
      const file = resolve("apps/api/public", request.url.slice(1));
      if (!existsSync(file)) {
        response.writeHead(404);
        response.end();
        return;
      }
      const bytes = readFileSync(file);
      response.end(
        corrupt && request.url.endsWith("hook.js")
          ? Buffer.from("corrupt")
          : bytes,
      );
    }),
  );
  const directory = mkdtempSync(join(tmpdir(), "agentcommons-install-"));
  const home = join(directory, "native");
  const bin = join(directory, "bin");
  mkdirSync(bin);
  for (const name of ["claude", "codex", "gemini", "pi"])
    writeFileSync(join(bin, name), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  const env = {
    ...process.env,
    // Spawned shims must never see the developer's real home: a reconfigure run would
    // otherwise edit real harness settings. The fixture directory stands in for HOME.
    HOME: directory,
    AGENTCOMMONS_DIR: join(directory, "data"),
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    SHELL: "/bin/bash",
  };
  const args = [
    resolve("apps/api/public/install.sh"),
    "--server",
    server,
    "--key",
    "test-credential",
    "--config-home",
    home,
  ];
  // The exports an older installer wrote, which this one removes (R-INST-10).
  mkdirSync(home, { recursive: true });
  writeFileSync(
    join(home, ".bashrc"),
    "alias ll='ls -l'\n\n# agentcommons-hook begin\nexport AGENTCOMMONS_API_KEY='test-credential'\n# agentcommons-hook end\n",
  );
  const installed = await run("sh", args, env);
  expect(installed, installed.output).toMatchObject({ code: 0 });
  expect(installed.output).toContain("trust hooks");
  // Every configured harness's global instructions file carries the guidance block; the
  // installer names the files instead of asking the user to paste anything.
  const instructionFiles = [
    join(home, ".claude", "CLAUDE.md"),
    join(home, ".codex", "AGENTS.md"),
    join(home, ".gemini", "GEMINI.md"),
  ];
  for (const file of instructionFiles) {
    expect(installed.output).toContain(file);
    expect(readFileSync(file, "utf8")).toContain(
      "<!-- agentcommons-hook begin -->",
    );
    expect(readFileSync(file, "utf8")).toContain("## AgentCommons");
  }
  expect(installed.output).toContain(
    "pi reads the AgentCommons guidance from its extension",
  );
  // No shell carries the key: every harness reads it from its own MCP entry (R-INST-10).
  expect(installed.output).not.toContain("AGENTCOMMONS_API_KEY");
  expect(readFileSync(join(home, ".bashrc"), "utf8")).toBe(
    "alias ll='ls -l'\n",
  );
  const fishConfig = join(home, ".config", "fish", "config.fish");
  for (const rc of [".profile", ".zshrc", ".bash_profile", ".zprofile"])
    expect(existsSync(join(home, rc)), rc).toBe(false);
  expect(existsSync(fishConfig)).toBe(false);
  const configFile = join(env.AGENTCOMMONS_DIR, "config.json");
  const first = readFileSync(configFile, "utf8");
  expect(statSync(configFile).mode & 0o777).toBe(0o600);
  expect((await run("sh", args, env)).code).toBe(0);
  expect(readFileSync(configFile, "utf8")).toBe(first);
  const bytes = readFileSync(join(env.AGENTCOMMONS_DIR, "hook.js"));
  corrupt = true;
  expect((await run("sh", args, env)).code).not.toBe(0);
  expect(readFileSync(join(env.AGENTCOMMONS_DIR, "hook.js"))).toEqual(bytes);
  const before = requests;
  expect(
    (
      await run(
        "sh",
        [
          resolve("apps/api/public/install.sh"),
          "--uninstall",
          "--config-home",
          home,
        ],
        env,
      )
    ).code,
  ).toBe(0);
  expect(requests).toBe(before);
  expect(readFileSync(configFile, "utf8")).toBe(first);
  // Uninstall removes the guidance block; a file that held only the block is removed.
  for (const file of instructionFiles) expect(existsSync(file)).toBe(false);
  const invalid = await run(
    process.execPath,
    [join(env.AGENTCOMMONS_DIR, "hook.js"), "doctor", "--config-home", home],
    { ...env, AGENTCOMMONS_API_KEY: "wrong" },
  );
  expect(invalid.code).not.toBe(0);
  // The self-update self-test runs `version` against the installation's configuration: a
  // bundle that cannot read it (a plain-HTTP remote server, R-INST-09) fails here instead of
  // swapping in and failing open in every hook from then on.
  const plain = await run(
    process.execPath,
    [join(env.AGENTCOMMONS_DIR, "hook.js"), "version"],
    { ...env, AGENTCOMMONS_SERVER: "http://agentcommons.example.test" },
  );
  expect(plain.code).not.toBe(0);
  expect(plain.output).toContain("plain HTTP is accepted only for localhost");
  const current = await run(
    process.execPath,
    [join(env.AGENTCOMMONS_DIR, "hook.js"), "version"],
    env,
  );
  expect(current.output.trim()).toMatch(/^[a-f0-9]{64}$/);
});

// @req R-CAP-04
it("terminates an expired real owner before one of two contenders takes over", async () => {
  const directory = mkdtempSync(join(tmpdir(), "agentcommons-expired-owner-"));
  const config = configure(directory, {
    server: "http://127.0.0.1:1",
    key: "test",
    organizationId: "native-org",
    credentialHash: (await import("../src/files.js")).hash("test"),
  });
  const transcript = join(directory, "source.jsonl");
  writeFileSync(transcript, '{"uuid":"record"}\n');
  const path = recordHook(directory, "/none", config, "claude", {
    session_id: randomUUID(),
    cwd: directory,
    transcript_path: transcript,
    hook_event_name: "Stop",
  });
  if (!path) throw new Error("Missing state.");
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      resolve("packages/hook/test/kill-worker.ts"),
      directory,
      path,
      "persisted",
    ],
    { stdio: ["ignore", "pipe", "pipe", "ipc"] },
  );
  await Promise.race([
    once(child, "message"),
    once(child, "exit").then(() => {
      throw new Error("Worker exited before acquiring its lock.");
    }),
  ]);
  const owner = ownerPath(path);
  const previous = JSON.parse(readFileSync(owner, "utf8")) as Record<
    string,
    unknown
  >;
  (await import("../src/files.js")).writeAtomic(owner, {
    ...previous,
    since: Date.now() - 300001,
  });
  const exited = once(child, "exit");
  const { acquireLock } = await import("../src/lock.js");
  const contenders = await Promise.all([
    acquireLock(owner),
    acquireLock(owner),
  ]);
  await exited;
  expect(contenders.filter(Boolean)).toHaveLength(1);
  expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
  for (const lock of contenders) lock?.release();
});
