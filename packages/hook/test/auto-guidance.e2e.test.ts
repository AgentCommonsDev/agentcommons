import { execFile, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, expect, it } from "vitest";
import { hash, writeAtomic } from "../src/files.js";
import { configure } from "../src/install.js";
import { loadState, ownerPath, statePath } from "../src/state.js";
import { wiredConfigHome } from "./fixture.js";

const executable = resolve("packages/hook/dist/hook.js");
const REMOTE = "git@github.com:acme/widgets.git";
const REPO = "github.com/acme/widgets";
const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((done) => {
      server.close(() => {
        done();
      });
    });
  }
});
/** Accepts every upload, answers `/me` and serves the built manifest so the uploader stays current. */
async function acceptingServer(): Promise<string> {
  const server = createServer((request, response) => {
    if (request.url === "/api/v1/me") {
      response.end(
        JSON.stringify({ organization: { id: "native-better-auth-org-id" } }),
      );
      return;
    }
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
    request.resume();
    request.on("end", () => {
      response.writeHead(202);
      response.end();
    });
  });
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No TCP address.");
  return `http://127.0.0.1:${String(address.port)}`;
}
async function until(condition: () => boolean, what: string): Promise<void> {
  for (let waited = 0; waited < 20_000; waited += 100) {
    if (condition()) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${what}.`);
}
/** The live-captured Claude Code events of one session, remapped into the temporary checkout. */
function fixtureEvents(repository: string, transcript: string) {
  const sessionId = randomUUID();
  return readFileSync(
    resolve("fixtures/hooks/claude-code-2.1.265-hook-events.jsonl"),
    "utf8",
  )
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((event) =>
      ["SessionStart", "UserPromptSubmit", "Stop", "SessionEnd"].includes(
        String(event.hook_event_name),
      ),
    )
    .map((event) => ({
      ...event,
      session_id: sessionId,
      cwd: repository,
      transcript_path: transcript,
    }));
}

// @req R-CAP-25 @req R-CAP-26
it.each([false, true])(
  "capture and upload leave the repository unchanged (legacy auto guidance: %s)",
  async (legacy) => {
    const server = await acceptingServer();
    const directory = mkdtempSync(
      join(tmpdir(), "agentcommons-no-auto-guidance-"),
    );
    const home = wiredConfigHome(directory, "ok", server).installOptions
      .configHome;
    configure(directory, {
      server,
      key: "test-credential",
      ...(legacy ? { guidance: { auto: true } } : {}),
    });
    const repository = mkdtempSync(
      join(tmpdir(), "agentcommons-guidance-repo-"),
    );
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: repository, encoding: "utf8" });
    git("init", "-q");
    git("remote", "add", "origin", REMOTE);
    writeFileSync(join(repository, "project.txt"), "User work.\n");
    git("add", "project.txt");
    git(
      "-c",
      "user.name=Example",
      "-c",
      "user.email=user@example.com",
      "commit",
      "-qm",
      "initial",
    );
    const head = git("rev-parse", "HEAD");
    // An already staged user edit must also survive unchanged.
    writeFileSync(join(repository, "project.txt"), "Staged user work.\n");
    git("add", "project.txt");
    const index = git("diff", "--cached");
    const status = git("status", "--porcelain");
    const transcript = join(directory, "transcript.jsonl");
    writeFileSync(transcript, '{"uuid":"one"}\n');
    const env = {
      ...process.env,
      AGENTCOMMONS_DIR: directory,
      HOME: home,
      AGENTCOMMONS_GUIDANCE_AUTO: legacy ? "1" : "",
    };
    const hook = (event: Record<string, unknown>) =>
      execFileSync(process.execPath, [executable, "claude"], {
        input: JSON.stringify(event),
        env,
        timeout: 10_000,
      }).toString();
    const [start, prompt] = fixtureEvents(repository, transcript);
    if (!start || !prompt)
      throw new Error("The fixture lacks the lifecycle events.");
    const path = statePath(directory, "claude", start.session_id);
    const decisionPath = join(directory, "guidance", `${hash(REPO)}.json`);
    if (legacy)
      writeAtomic(decisionPath, {
        v: 1,
        repository: REPO,
        root: repository,
        decision: "written",
        blockHash: "old",
        files: ["AGENTS.md", "CLAUDE.md", "GEMINI.md"],
        announce: true,
        at: Date.now(),
      });
    expect(hook(start)).toBe("");
    await until(() => {
      try {
        const cursor = loadState(path).ackedCursor;
        return (
          cursor.kind === "jsonl" &&
          cursor.offset > 0 &&
          !existsSync(ownerPath(path))
        );
      } catch {
        return false;
      }
    }, "the detached uploader to acknowledge the transcript");
    expect(loadState(path).context.git?.root).toBe(repository);
    expect(hook(prompt)).toBe("");
    // Await an entire uploader invocation, including its work after releasing the drain lock.
    await promisify(execFile)(process.execPath, [executable, "upload", path], {
      env,
      timeout: 20_000,
    });
    for (const name of ["AGENTS.md", "CLAUDE.md", "GEMINI.md"])
      expect(
        lstatSync(join(repository, name), { throwIfNoEntry: false }),
      ).toBeUndefined();
    expect(git("status", "--porcelain")).toBe(status);
    expect(git("diff", "--cached")).toBe(index);
    expect(git("rev-parse", "HEAD")).toBe(head);
    expect(existsSync(decisionPath)).toBe(legacy);
  },
);
