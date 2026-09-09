import { appendFileSync, statSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HARNESSES, type CliHarness } from "../src/harnesses.js";
import { intents, loadState } from "../src/state.js";
import {
  SETTLE_MAX_POLLS,
  SETTLE_POLL_MS,
  SETTLE_QUIET_POLLS,
  upload,
} from "../src/upload.js";
import type { IngestEnvelope } from "@agentcommons/core/schemas/ingest";
import { fixture, SHIM } from "./fixture.js";

// Live captures (Appendix A): Claude Code appends the final assistant record up to
// 400 ms after `Stop` fires and the child's final record 15–20 ms after `SubagentStop`.
function settleFixture(
  harness: CliHarness,
  transcriptName: string,
  initial: string,
) {
  return {
    ...fixture({ harness, transcriptName, initial }),
    sleeps: [] as number[],
  };
}
const keysOf = (received: readonly IngestEnvelope[]) =>
  received.flatMap((body) => body.records.map((record) => record.key));

describe("post-turn settle", () => {
  // @req R-CAP-15
  it.each([
    ["claude", "Stop", "uuid"],
    ["codex", "Stop", "ordinal"],
    ["pi", "agent_end", "id"],
  ] as const)(
    "%s: uploads records appended after %s in the same run, then stops after 2 s of quiet",
    async (harness, turnEnd, keyField) => {
      const line = (key: string) => `${JSON.stringify({ [keyField]: key })}\n`;
      const f = settleFixture(harness, "transcript.jsonl", line("prompt"));
      const path = f.hook({ hook_event_name: turnEnd });
      const sleep = (milliseconds: number) => {
        f.sleeps.push(milliseconds);
        // The harness finishes writing while the uploader waits.
        if (f.sleeps.length === 2) appendFileSync(f.transcript, line("final"));
        if (f.sleeps.length === 4) appendFileSync(f.transcript, line("after"));
        return Promise.resolve();
      };
      await upload(f.directory, SHIM, path, f.config, {
        fetch: f.fetcher,
        sleep,
        sweep: false,
      });
      expect(keysOf(f.received)).toEqual(["prompt", "final", "after"]);
      expect(f.received.map((body) => body.records.length)).toEqual([1, 1, 1]);
      // Growth restarts the quiet window; the run ends 8 quiet polls after the last append.
      expect(f.sleeps).toEqual(
        Array<number>(2 + 2 + SETTLE_QUIET_POLLS).fill(SETTLE_POLL_MS),
      );
      expect(loadState(path).ackedCursor).toEqual({
        kind: "jsonl",
        offset: statSync(f.transcript).size,
      });
      expect(loadState(path).pending).toBeNull();
      expect(intents(path, loadState(path))).toHaveLength(0);
    },
  );

  // @req R-CAP-15
  it("gemini: re-reads a rewritten document after AfterAgent and emits only the new message", async () => {
    const document = (messages: { id: string; content: string }[]) =>
      JSON.stringify({ sessionId: "native", messages });
    const f = settleFixture(
      "gemini",
      "session.json",
      document([{ id: "a", content: "prompt" }]),
    );
    const path = f.hook({ hook_event_name: "AfterAgent" });
    const sleep = (milliseconds: number) => {
      f.sleeps.push(milliseconds);
      if (f.sleeps.length === 1)
        writeFileSync(
          f.transcript,
          document([
            { id: "a", content: "prompt" },
            { id: "b", content: "final answer" },
          ]),
        );
      return Promise.resolve();
    };
    await upload(f.directory, SHIM, path, f.config, {
      fetch: f.fetcher,
      sleep,
      sweep: false,
    });
    const keys = keysOf(f.received).map((key) => key?.split(":")[0]);
    expect(keys).toEqual(["a", "b"]);
    expect(f.received.at(-1)?.context.transcriptMetadata).toEqual({
      sessionId: "native",
      sourceRecordCount: 2,
    });
    expect(f.sleeps).toHaveLength(1 + SETTLE_QUIET_POLLS);
  });

  // @req R-CAP-15 @req R-CAP-03
  it("does not wait after hooks that cannot precede a final record, and caps a busy settle at 5 s", async () => {
    const f = settleFixture(
      "claude",
      "transcript.jsonl",
      '{"uuid":"prompt"}\n',
    );
    const path = f.hook({ hook_event_name: "UserPromptSubmit" });
    const sleep = (milliseconds: number) => {
      f.sleeps.push(milliseconds);
      return Promise.resolve();
    };
    await upload(f.directory, SHIM, path, f.config, {
      fetch: f.fetcher,
      sleep,
      sweep: false,
    });
    expect(f.sleeps).toEqual([]);
    expect(keysOf(f.received)).toEqual(["prompt"]);
    f.hook({ hook_event_name: "Stop" });
    let appended = 0;
    const busy = (milliseconds: number) => {
      f.sleeps.push(milliseconds);
      // A harness that never goes quiet must not hold the uploader for more than 5 s.
      appendFileSync(f.transcript, `{"uuid":"stream-${String(++appended)}"}\n`);
      return Promise.resolve();
    };
    await upload(f.directory, SHIM, path, f.config, {
      fetch: f.fetcher,
      sleep: busy,
      sweep: false,
    });
    expect(f.sleeps).toHaveLength(SETTLE_MAX_POLLS);
    expect(f.sleeps.reduce((sum, value) => sum + value, 0)).toBe(5000);
    expect(keysOf(f.received)).toHaveLength(1 + SETTLE_MAX_POLLS);
    expect(loadState(path).ackedCursor).toEqual({
      kind: "jsonl",
      offset: statSync(f.transcript).size,
    });
  });

  // @req R-CAP-15 @req R-CAP-05
  it("acknowledges uploaded records before waiting, so a kill during the settle loses nothing and duplicates nothing", async () => {
    const f = settleFixture(
      "claude",
      "transcript.jsonl",
      '{"uuid":"prompt"}\n',
    );
    const path = f.hook({ hook_event_name: "Stop" });
    const uploaded = statSync(f.transcript).size;
    await expect(
      upload(f.directory, SHIM, path, f.config, {
        fetch: f.fetcher,
        sleep: () => Promise.reject(new Error("killed during settle")),
        sweep: false,
      }),
    ).rejects.toThrow("killed during settle");
    const interrupted = loadState(path);
    expect(keysOf(f.received)).toEqual(["prompt"]);
    expect(interrupted.ackedCursor).toEqual({
      kind: "jsonl",
      offset: uploaded,
    });
    expect(interrupted.pending).toBeNull();
    expect(interrupted.cleanup).toEqual({ files: [], intents: [] });
    expect(intents(path, interrupted)).toHaveLength(0);
    // The final record lands after the kill; the next hook ships exactly that record.
    appendFileSync(f.transcript, '{"uuid":"final"}\n');
    f.hook({ hook_event_name: "SessionEnd" });
    await upload(f.directory, SHIM, path, f.config, {
      fetch: f.fetcher,
      sleep: () => Promise.resolve(),
      sweep: false,
    });
    expect(keysOf(f.received)).toEqual(["prompt", "final"]);
    // The end receipt is sent first; the late record follows as a final sync (§5.2).
    expect(f.received.map((body) => body.behavior)).toEqual([
      "sync",
      "end",
      "sync",
    ]);
    expect(loadState(path).ackedCursor).toEqual({
      kind: "jsonl",
      offset: statSync(f.transcript).size,
    });
  });

  // @req R-CAP-15 @req R-HRN-07
  it("marks exactly the turn-end hooks of every harness as settle events", () => {
    expect(
      Object.fromEntries(
        Object.entries(HARNESSES).map(([name, definition]) => [
          name,
          Object.entries(definition.events)
            .filter(([, event]) => event.settle)
            .map(([event]) => event),
        ]),
      ),
    ).toEqual({
      claude: ["Stop", "SubagentStop"],
      codex: ["Stop", "SubagentStop"],
      gemini: ["AfterAgent"],
      pi: ["agent_end"],
    });
  });
});
