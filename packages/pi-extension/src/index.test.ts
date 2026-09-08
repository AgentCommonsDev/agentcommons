import { EventEmitter } from "node:events";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { afterEach, expect, it, vi } from "vitest";

const child = vi.hoisted(() => ({
  spawn: vi.fn(),
  write: vi.fn(),
  unref: vi.fn(),
}));
vi.mock("node:child_process", () => ({ spawn: child.spawn }));
import extension from "./index.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
// @req R-HRN-05
it("observes six native events, transports leaf changes and resume reasons, and returns no host mutation", () => {
  const directory = mkdtempSync(join(tmpdir(), "agentcommons-pi-extension-"));
  writeFileSync(
    join(directory, "config.json"),
    JSON.stringify({ node: process.execPath }),
  );
  vi.stubEnv("AGENTCOMMONS_DIR", directory);
  const stdin = Object.assign(new EventEmitter(), { end: child.write });
  child.spawn.mockImplementation(() =>
    Object.assign(new EventEmitter(), { stdin, unref: child.unref }),
  );
  const callbacks = new Map<
    string,
    (event: { reason?: string }, context: ExtensionContext) => unknown
  >();
  const api = {
    on: (
      name: string,
      callback: (
        event: { reason?: string },
        context: ExtensionContext,
      ) => unknown,
    ) => callbacks.set(name, callback),
  } as unknown as ExtensionAPI;
  extension(api);
  expect([...callbacks.keys()]).toEqual([
    "session_start",
    "input",
    "tool_result",
    "agent_end",
    "session_tree",
    "session_shutdown",
  ]);
  let leaf = "previous-leaf";
  const context = {
    cwd: directory,
    sessionManager: {
      getSessionId: () => "native-session",
      getSessionFile: () => join(directory, "native.jsonl"),
      getLeafId: () => leaf,
    },
  } as unknown as ExtensionContext;
  for (const [name, callback] of callbacks) {
    if (name === "session_tree") leaf = "new-leaf";
    expect(
      callback(
        { ...(name === "session_start" ? { reason: "resume" } : {}) },
        context,
      ),
    ).toBeUndefined();
  }
  expect(child.spawn).toHaveBeenCalledTimes(6);
  expect(child.unref).toHaveBeenCalledTimes(6);
  const payloads: unknown[] = child.write.mock.calls.map(
    (call: unknown[]) =>
      JSON.parse(typeof call[0] === "string" ? call[0] : "null") as unknown,
  );
  expect(payloads[0]).toMatchObject({
    hook_event_name: "session_start",
    reason: "resume",
    activeLeafId: "previous-leaf",
  });
  expect(payloads[4]).toMatchObject({
    hook_event_name: "session_tree",
    activeLeafId: "new-leaf",
  });
  const duplicate = { reason: "resume" };
  callbacks.get("session_start")?.(duplicate, context);
  callbacks.get("session_start")?.(duplicate, context);
  const duplicateCalls: unknown[] = child.write.mock.calls
    .slice(-2)
    .map(
      (call: unknown[]) =>
        JSON.parse(typeof call[0] === "string" ? call[0] : "null") as unknown,
    );
  expect(duplicateCalls[0]).toEqual(duplicateCalls[1]);
  expect(child.spawn).toHaveBeenLastCalledWith(
    process.execPath,
    [join(directory, "hook.js"), "pi"],
    { detached: true, stdio: ["pipe", "ignore", "ignore"] },
  );
});
