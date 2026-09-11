import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  guidanceBlock,
  repositoryInstructions,
} from "@agentcommons/core/format/install";
import { afterEach, expect, it } from "vitest";
import {
  guidanceAnnouncementText,
  guidanceDecisionPath,
  readGuidanceDecision,
} from "../src/guidance.js";
import { configure } from "../src/install.js";
import { hookContextOutput } from "../src/recall.js";
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

// @req R-CAP-25 @req R-CAP-26 @req R-INST-08
it("the built hook's uploader writes the guidance into a fresh checkout on the first session, the next prompt announces it once, and --off holds", async () => {
  const server = await acceptingServer();
  const directory = mkdtempSync(join(tmpdir(), "agentcommons-auto-guidance-"));
  // Hook mode reads the harness MCP file of `HOME`; an isolated home carries a wired entry so
  // the session is hinted rather than told to repair its install (§6.2). No install flags are
  // recorded, so the uploader's reconcile step leaves this directory alone.
  const home = wiredConfigHome(directory, "ok", server).installOptions
    .configHome;
  configure(directory, { server, key: "test-credential" });
  const repository = mkdtempSync(
    join(tmpdir(), "agentcommons-auto-guidance-repo-"),
  );
  execFileSync("git", ["init", "-q"], { cwd: repository });
  execFileSync("git", ["remote", "add", "origin", REMOTE], { cwd: repository });
  const transcript = join(directory, "transcript.jsonl");
  writeFileSync(transcript, '{"uuid":"one"}\n');
  const env = { ...process.env, AGENTCOMMONS_DIR: directory, HOME: home };
  const hook = (event: Record<string, unknown>): string =>
    execFileSync(process.execPath, [executable, "claude"], {
      input: JSON.stringify(event),
      env,
      timeout: 10_000,
    }).toString();
  const events = fixtureEvents(repository, transcript);
  const [start, prompt, stop] = events;
  if (!start || !prompt || !stop)
    throw new Error("The fixture lacks the lifecycle events.");
  const path = statePath(directory, "claude", start.session_id);
  const decisionPath = guidanceDecisionPath(directory, REPO);
  // No prior sessions in the index: the start event is silent and spawns the uploader.
  expect(hook(start)).toBe("");
  await until(
    () => existsSync(decisionPath),
    "the uploader's guidance decision",
  );
  await until(() => !existsSync(ownerPath(path)), "the uploader to finish");
  expect(loadState(path).context.git?.root).toBe(repository);
  const block = `${guidanceBlock(repositoryInstructions)}\n`;
  expect(readFileSync(join(repository, "AGENTS.md"), "utf8")).toBe(block);
  for (const name of ["CLAUDE.md", "GEMINI.md"]) {
    expect(lstatSync(join(repository, name)).isSymbolicLink()).toBe(true);
    expect(readlinkSync(join(repository, name))).toBe("AGENTS.md");
  }
  expect(readGuidanceDecision(directory, REPO)).toMatchObject({
    decision: "written",
    root: repository,
    files: ["AGENTS.md", "CLAUDE.md", "GEMINI.md"],
    announce: true,
  });
  // The captured prompt event of the same session carries the announcement, once.
  expect(hook(prompt)).toBe(
    hookContextOutput(
      "UserPromptSubmit",
      guidanceAnnouncementText(["AGENTS.md", "CLAUDE.md", "GEMINI.md"]),
    ),
  );
  expect(hook({ ...prompt, prompt_id: randomUUID() })).toBe("");
  expect(hook(stop)).toBe("");
  await until(
    () => !existsSync(ownerPath(path)),
    "the second uploader to finish",
  );
  // `--off` removes what was written and the next session's uploader honours it.
  const off = execFileSync(
    process.execPath,
    [executable, "guidance", "--repo", repository, "--off"],
    { env, encoding: "utf8" },
  );
  expect(off).toContain("Removed the AgentCommons guidance from");
  for (const name of ["AGENTS.md", "CLAUDE.md", "GEMINI.md"])
    expect(
      lstatSync(join(repository, name), { throwIfNoEntry: false }),
    ).toBeUndefined();
  expect(readGuidanceDecision(directory, REPO)?.decision).toBe("declined");
  const [second] = fixtureEvents(repository, transcript);
  if (!second) throw new Error("The fixture lacks a start event.");
  const secondPath = statePath(directory, "claude", second.session_id);
  expect(hook(second)).toBe("");
  await until(() => {
    try {
      return loadState(secondPath).context.git !== null;
    } catch {
      return false;
    }
  }, "the second session's git context");
  await until(
    () => !existsSync(ownerPath(secondPath)),
    "the third uploader to finish",
  );
  expect(existsSync(join(repository, "AGENTS.md"))).toBe(false);
  expect(readGuidanceDecision(directory, REPO)?.decision).toBe("declined");
  expect(readFileSync(join(directory, "hook.log"), "utf8")).toContain(
    `Repository guidance written in ${repository}: AGENTS.md, CLAUDE.md, GEMINI.md.`,
  );
});
