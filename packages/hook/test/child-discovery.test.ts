import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type * as childProcess from "node:child_process";
import { expect, it, vi } from "vitest";
import { nativeHookSchema } from "../src/harnesses.js";
import { recordHook } from "../src/hook.js";
import { intents, loadState, statePath } from "../src/state.js";
import { SETTLE_QUIET_POLLS, upload } from "../src/upload.js";
import { fixture, SHIM } from "./fixture.js";

const processes = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof childProcess>()),
  spawn: processes.spawn.mockReturnValue({
    on: () => undefined,
    unref: () => undefined,
  }),
}));

// Replay the captured native stop shape. Only its local session/path and event
// time are rebased; source absence and delayed writes are filesystem conditions.
const capturedStop = readFileSync(
  new URL(
    "../../../fixtures/hooks/claude-code-2.1.265-hook-events.jsonl",
    import.meta.url,
  ),
  "utf8",
)
  .trim()
  .split("\n")
  .map((line) => nativeHookSchema.parse(JSON.parse(line) as unknown))
  .find((event) => event.hook_event_name === "SubagentStop");
if (!capturedStop?.agent_id) throw new Error("Missing captured child stop.");
const stop = capturedStop;
const sentAt = "2026-09-30T12:00:00.000Z";
const record = '{"uuid":"late-child-record"}\n';

function childFixture() {
  const f = fixture();
  const transcript = join(
    f.directory,
    f.event.session_id,
    "subagents",
    `agent-${stop.agent_id ?? ""}.jsonl`,
  );
  mkdirSync(dirname(transcript), { recursive: true });
  const sessionId = `${f.event.session_id}:agent-${stop.agent_id ?? ""}`;
  const childPath = statePath(f.directory, "claude", sessionId);
  const event = {
    ...stop,
    ...f.event,
    hook_event_name: "SubagentStop",
    agent_transcript_path: transcript,
    timestamp: sentAt,
  };
  const sleep = vi.fn().mockResolvedValue(undefined);
  const options = {
    fetch: f.fetcher,
    sleep,
    update: false,
    recall: false,
    policy: false,
    sweep: false,
  };
  const run = (path: string, sweep = false) =>
    upload(f.directory, SHIM, path, f.config, { ...options, sweep });
  const batches = () =>
    f.received.filter((body) => body.harnessSessionId === sessionId);
  return { ...f, transcript, childPath, event, sleep, options, run, batches };
}

// @req R-CAP-09 @req R-LNK-01 @req R-CAP-15
it.each(["missing", "empty"] as const)(
  "keeps a stop-only %s child local and durable without repeated settling or respawn",
  async (source) => {
    const f = childFixture();
    if (source === "empty") writeFileSync(f.transcript, "");
    const parent = f.hook(f.event);
    await f.run(parent);
    expect(f.received.some((body) => body.records.length > 0)).toBe(true);
    expect(f.batches()).toEqual([]);
    const initial = loadState(f.childPath);
    const held = intents(f.childPath, initial);
    expect(held).toHaveLength(1);
    expect(held[0]).toMatchObject({
      behavior: "end",
      nativeEvent: "SubagentStop",
      sentAt,
      transcriptPath: f.transcript,
    });
    expect(initial.ackedCursor).toEqual({ kind: "jsonl", offset: 0 });
    expect(initial.source).toEqual({ signature: null, size: 0, watermark: 0 });
    expect(f.sleep).toHaveBeenCalledTimes(SETTLE_QUIET_POLLS * 2);

    f.sleep.mockClear();
    processes.spawn.mockClear();
    await f.run(parent);
    await f.run(f.childPath);
    expect(f.sleep).not.toHaveBeenCalled();
    expect(processes.spawn).not.toHaveBeenCalled();
    expect(intents(f.childPath, loadState(f.childPath))).toEqual(held);
    expect(f.batches()).toEqual([]);
  },
);

// @req R-CAP-09 @req R-CAP-15
it("discovers a stop-only transcript written during the child's settle window", async () => {
  const f = childFixture();
  const parent = f.hook(f.event);
  let polls = 0;
  f.sleep.mockImplementation(() => {
    polls++;
    // The parent has settled first; the child is still waiting for its file.
    if (polls === SETTLE_QUIET_POLLS + 1) writeFileSync(f.transcript, record);
    return Promise.resolve();
  });
  await f.run(parent);
  expect(f.batches().map((body) => body.behavior)).toEqual(["end", "sync"]);
  expect(f.batches()[0]?.sentAt).toBe(sentAt);
  expect(f.batches()[1]?.records[0]?.key).toBe("late-child-record");
  expect(intents(f.childPath, loadState(f.childPath))).toEqual([]);
});

// @req R-CAP-08 @req R-CAP-09
it.each(["parent", "sweep"] as const)(
  "discovers bytes after settling through a later %s drain",
  async (trigger) => {
    const f = childFixture();
    const parent = f.hook(f.event);
    await f.run(parent);
    const held = intents(f.childPath, loadState(f.childPath))[0];
    writeFileSync(f.transcript, record);
    if (trigger === "parent") await f.run(parent);
    else {
      const other = recordHook(f.directory, SHIM, f.config, "claude", {
        ...f.event,
        session_id: "unrelated-session",
        hook_event_name: "UserPromptSubmit",
      });
      if (!other) throw new Error("Missing unrelated state.");
      await f.run(other, true);
    }
    expect(f.batches()[0]).toMatchObject({
      behavior: "end",
      sentAt: held?.sentAt,
      sourcePos: held?.source.watermark,
    });
    expect(f.batches()[1]?.records[0]?.key).toBe("late-child-record");
    expect(loadState(f.childPath).ackedCursor).toEqual({
      kind: "jsonl",
      offset: Buffer.byteLength(record),
    });
  },
);

// @req R-CAP-08
it("leaves the sweep slot available to a real pending session", async () => {
  const f = childFixture();
  const parent = f.hook(f.event);
  await f.run(parent);
  const otherTranscript = join(f.directory, "other.jsonl");
  writeFileSync(otherTranscript, '{"uuid":"unrelated-record"}\n');
  recordHook(f.directory, SHIM, f.config, "claude", {
    ...f.event,
    session_id: "unrelated-session",
    transcript_path: otherTranscript,
    hook_event_name: "UserPromptSubmit",
  });
  const caller = recordHook(f.directory, SHIM, f.config, "claude", {
    ...f.event,
    session_id: "sweep-caller",
    hook_event_name: "UserPromptSubmit",
  });
  if (!caller) throw new Error("Missing sweep caller.");
  await f.run(caller, true);
  expect(
    f.received.some((body) =>
      body.records.some((item) => item.key === "unrelated-record"),
    ),
  ).toBe(true);
  expect(f.batches()).toEqual([]);
});

// @req R-LNK-01 @req R-CAP-09
it("sends end immediately for a registered child even when its source is still empty", async () => {
  const f = childFixture();
  const parent = f.hook({
    ...f.event,
    hook_event_name: "SubagentStart",
    timestamp: "2026-09-30T11:59:00.000Z",
  });
  await f.run(parent);
  f.hook(f.event);
  await f.run(parent);
  expect(f.batches().map((body) => body.behavior)).toEqual(["start", "end"]);
  expect(intents(f.childPath, loadState(f.childPath))).toEqual([]);
});

// @req R-CAP-09
it.each(["present", "removed", "truncated"] as const)(
  "honors real bytes observed by a stop when the file is %s at drain time",
  async (source) => {
    const f = childFixture();
    writeFileSync(f.transcript, record);
    const parent = f.hook(f.event);
    if (source === "removed") rmSync(f.transcript);
    if (source === "truncated") writeFileSync(f.transcript, "");
    await f.run(parent);
    expect(f.batches()[0]).toMatchObject({
      behavior: "end",
      sourcePos: Buffer.byteLength(record),
    });
    if (source === "present")
      expect(f.batches()[1]?.records[0]?.key).toBe("late-child-record");
  },
);

// @req R-CAP-05 @req R-CAP-09
it("resends an already persisted child batch unchanged when its source disappears", async () => {
  const f = childFixture();
  writeFileSync(f.transcript, record);
  const parent = f.hook(f.event);
  await expect(
    upload(f.directory, SHIM, parent, f.config, {
      ...f.options,
      checkpoint: (point, state) => {
        if (point === "persisted" && state.sessionId.includes(":agent-"))
          throw new Error("interrupted after persist");
        return Promise.resolve();
      },
    }),
  ).rejects.toThrow("interrupted after persist");
  const pending = loadState(f.childPath).pending;
  if (!pending) throw new Error("Missing persisted child batch.");
  const exactBody = readFileSync(pending.file, "utf8");
  rmSync(f.transcript);
  const sent: unknown[] = [];
  await upload(f.directory, SHIM, f.childPath, f.config, {
    ...f.options,
    fetch: (url, options) => {
      if (options?.method === "POST") sent.push(options.body);
      return f.fetcher(url, options);
    },
  });
  expect(sent[0]).toBe(exactBody);
  expect(loadState(f.childPath).pending).toBeNull();
  expect(intents(f.childPath, loadState(f.childPath))).toEqual([]);
});

// @req R-CAP-02
it("preserves an empty root session's end lifecycle", async () => {
  const f = fixture({ initial: "" });
  const root = f.hook({ hook_event_name: "SessionEnd" });
  await upload(f.directory, SHIM, root, f.config, {
    fetch: f.fetcher,
    sweep: false,
    update: false,
    recall: false,
    policy: false,
  });
  expect(f.received.map((body) => body.behavior)).toEqual(["end"]);
});

// @req R-CAP-08 @req R-CAP-09
it("wakes an older missing-source end when a newer end corrects the child path", async () => {
  const f = childFixture();
  const parent = f.hook(f.event);
  await f.run(parent);
  const corrected = join(f.directory, "corrected-child.jsonl");
  // The correction itself observes no bytes; they appear after its hook ran.
  f.hook({
    ...f.event,
    agent_transcript_path: corrected,
    timestamp: "2026-09-30T12:00:01.000Z",
    event_id: "corrected-child-stop",
  });
  await f.run(parent);
  expect(f.batches()).toEqual([]);
  expect(intents(f.childPath, loadState(f.childPath))).toHaveLength(2);
  writeFileSync(corrected, record);
  await f.run(f.childPath, true);
  expect(f.batches().at(-1)?.records[0]?.key).toBe("late-child-record");
  expect(loadState(f.childPath).transcriptPath).toBe(corrected);
  expect(intents(f.childPath, loadState(f.childPath))).toEqual([]);
});

// @req R-CAP-09 @req R-CAP-15
it("settles once for a corrected child path even while an earlier end is retained", async () => {
  const f = childFixture();
  const parent = f.hook(f.event);
  await f.run(parent);
  const corrected = join(f.directory, "corrected-child.jsonl");
  f.hook({
    ...f.event,
    agent_transcript_path: corrected,
    timestamp: "2026-09-30T12:00:01.000Z",
    event_id: "corrected-child-stop",
  });
  f.sleep.mockClear();
  let polls = 0;
  f.sleep.mockImplementation(() => {
    polls++;
    if (polls === SETTLE_QUIET_POLLS + 1) writeFileSync(corrected, record);
    return Promise.resolve();
  });
  await f.run(parent);
  expect(f.batches().at(-1)?.records[0]?.key).toBe("late-child-record");
  expect(loadState(f.childPath).transcriptPath).toBe(corrected);
  expect(loadState(f.childPath).contextSentAt).toBe("2026-09-30T12:00:01.000Z");
  f.sleep.mockClear();
  await f.run(parent);
  expect(f.sleep).not.toHaveBeenCalled();
});
