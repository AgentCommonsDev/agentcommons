import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { expect, it } from "vitest";
import { fixture, SHIM } from "./fixture.js";
import { recordHook, recoverUpload } from "../src/hook.js";
import { acquireLock } from "../src/lock.js";
import { loadState, ownerPath, statePath } from "../src/state.js";
import { upload } from "../src/upload.js";

async function waitFor(
  condition: () => boolean,
  timeoutMs = 5000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("Timed out.");
    await sleep(20);
  }
}
// @req R-CAP-22
it("a hook that cannot record its event still starts the session's uploader when none is live", async () => {
  const f = fixture();
  const path = statePath(f.directory, "claude", f.event.session_id);
  mkdirSync(dirname(path), { recursive: true });
  // A state file this bundle cannot read: every hook of the session would fail the same way.
  writeFileSync(path, "not json");
  expect(() =>
    recordHook(f.directory, SHIM, f.config, "claude", f.event),
  ).toThrow();
  // The recovery runs `node <executable> upload <state>`; a stand-in executable records its arguments.
  const executable = join(f.directory, "fake-hook.cjs");
  writeFileSync(
    executable,
    'require("node:fs").writeFileSync(process.argv[3] + ".spawned", process.argv.slice(2).join(" "));',
  );
  expect(
    recoverUpload(f.directory, executable, f.config, "claude", f.event),
  ).toBe(path);
  await waitFor(() => existsSync(`${path}.spawned`));
  expect(readFileSync(`${path}.spawned`, "utf8")).toBe(`upload ${path}`);
  rmSync(`${path}.spawned`);
  // A live owner means an uploader is already running: nothing is spawned twice.
  const lock = await acquireLock(ownerPath(path));
  if (!lock) throw new Error("The test could not take the owner lock.");
  try {
    expect(
      recoverUpload(f.directory, executable, f.config, "claude", f.event),
    ).toBeNull();
  } finally {
    lock.release();
  }
  await sleep(200);
  expect(existsSync(`${path}.spawned`)).toBe(false);
  // Without a session id there is no session to recover.
  expect(
    recoverUpload(f.directory, executable, f.config, "claude", {
      cwd: f.directory,
    }),
  ).toBeNull();
});
// @req R-CAP-22 @req R-CAP-04
it("an unreadable state file releases the owner lock, is logged, and does not block the sweep of other sessions", async () => {
  const f = fixture();
  const healthy = f.hook();
  const broken = statePath(f.directory, "claude", "broken-session");
  writeFileSync(broken, "{ not json");
  // The broken session's own uploader: no owner left behind, one log line, nothing thrown.
  await upload(f.directory, SHIM, broken, f.config, {
    fetch: f.fetcher,
    sweep: false,
    update: false,
    recall: false,
  });
  expect(existsSync(ownerPath(broken))).toBe(false);
  expect(readFileSync(join(f.directory, "hook.log"), "utf8")).toContain(
    `Session state unreadable, skipped: ${broken}`,
  );
  // Another session's uploader sweeps past the broken file and still delivers its own batch.
  await upload(f.directory, SHIM, healthy, f.config, {
    fetch: f.fetcher,
    update: false,
    recall: false,
  });
  expect(f.received.length).toBeGreaterThan(0);
  expect(loadState(healthy).pending).toBeNull();
});
