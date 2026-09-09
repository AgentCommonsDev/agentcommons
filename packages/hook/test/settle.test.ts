import { appendFileSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { configure } from "../src/install.js";
import { recordHook } from "../src/hook.js";
import { hash } from "../src/files.js";
import { HARNESSES, type CliHarness } from "../src/harnesses.js";
import { intents, loadState } from "../src/state.js";
import { upload } from "../src/upload.js";
import {
  ingestEnvelopeSchema,
  type IngestEnvelope,
} from "@agentcommons/core/schemas/ingest";

// Live captures (Appendix A): Claude Code appends the final assistant record up to
// 400 ms after `Stop` fires and the child's final record 15–20 ms after `SubagentStop`.
const POLL_MS = 250;
const QUIET_POLLS = 8;
const MAX_POLLS = 20;

function fixture(harness: CliHarness, transcriptName: string, initial: string) {
  const directory = mkdtempSync(join(tmpdir(), "agentcommons-settle-"));
  const config = configure(directory, {
    server: "http://127.0.0.1:3000",
    key: "test",
    organizationId: "019939c0-0000-7000-8000-000000000001",
    credentialHash: hash("test"),
  });
  const transcript = join(directory, transcriptName);
  writeFileSync(transcript, initial);
  const event = {
    session_id: randomUUID(),
    transcript_path: transcript,
    cwd: directory,
  };
  const hook = (hook_event_name: string) => {
    const path = recordHook(
      directory,
      "/nonexistent-test-shim.js",
      config,
      harness,
      { ...event, hook_event_name },
      "launch",
    );
    if (!path) throw new Error("Missing state.");
    return path;
  };
  const received: IngestEnvelope[] = [];
  const fetcher: typeof fetch = (_url, options) => {
    if (options?.method !== "POST")
      return Promise.resolve(
        Response.json({ organization: { id: config.organizationId } }),
      );
    received.push(
      ingestEnvelopeSchema.parse(
        JSON.parse(
          typeof options.body === "string" ? options.body : "null",
        ) as unknown,
      ),
    );
    return Promise.resolve(new Response(null, { status: 202 }));
  };
  const sleeps: number[] = [];
  return { directory, config, transcript, hook, received, fetcher, sleeps };
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
      const f = fixture(harness, "transcript.jsonl", line("prompt"));
      const path = f.hook(turnEnd);
      const sleep = (milliseconds: number) => {
        f.sleeps.push(milliseconds);
        // The harness finishes writing while the uploader waits.
        if (f.sleeps.length === 2) appendFileSync(f.transcript, line("final"));
        if (f.sleeps.length === 4) appendFileSync(f.transcript, line("after"));
        return Promise.resolve();
      };
      await upload(f.directory, "/nonexistent-test-shim.js", path, f.config, {
        fetch: f.fetcher,
        sleep,
        sweep: false,
      });
      expect(keysOf(f.received)).toEqual(["prompt", "final", "after"]);
      expect(f.received.map((body) => body.records.length)).toEqual([1, 1, 1]);
      // Growth restarts the quiet window; the run ends 8 quiet polls after the last append.
      expect(f.sleeps).toEqual(
        Array<number>(2 + 2 + QUIET_POLLS).fill(POLL_MS),
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
    const f = fixture(
      "gemini",
      "session.json",
      document([{ id: "a", content: "prompt" }]),
    );
    const path = f.hook("AfterAgent");
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
    await upload(f.directory, "/nonexistent-test-shim.js", path, f.config, {
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
    expect(f.sleeps).toHaveLength(1 + QUIET_POLLS);
  });

  // @req R-CAP-15 @req R-CAP-03
  it("does not wait after hooks that cannot precede a final record, and caps a busy settle at 5 s", async () => {
    const f = fixture("claude", "transcript.jsonl", '{"uuid":"prompt"}\n');
    const path = f.hook("UserPromptSubmit");
    const sleep = (milliseconds: number) => {
      f.sleeps.push(milliseconds);
      return Promise.resolve();
    };
    await upload(f.directory, "/nonexistent-test-shim.js", path, f.config, {
      fetch: f.fetcher,
      sleep,
      sweep: false,
    });
    expect(f.sleeps).toEqual([]);
    expect(keysOf(f.received)).toEqual(["prompt"]);
    f.hook("Stop");
    let appended = 0;
    const busy = (milliseconds: number) => {
      f.sleeps.push(milliseconds);
      // A harness that never goes quiet must not hold the uploader for more than 5 s.
      appendFileSync(f.transcript, `{"uuid":"stream-${String(++appended)}"}\n`);
      return Promise.resolve();
    };
    await upload(f.directory, "/nonexistent-test-shim.js", path, f.config, {
      fetch: f.fetcher,
      sleep: busy,
      sweep: false,
    });
    expect(f.sleeps).toHaveLength(MAX_POLLS);
    expect(f.sleeps.reduce((sum, value) => sum + value, 0)).toBe(5000);
    expect(keysOf(f.received)).toHaveLength(1 + MAX_POLLS);
    expect(loadState(path).ackedCursor).toEqual({
      kind: "jsonl",
      offset: statSync(f.transcript).size,
    });
  });

  // @req R-CAP-15 @req R-CAP-05
  it("acknowledges uploaded records before waiting, so a kill during the settle loses nothing and duplicates nothing", async () => {
    const f = fixture("claude", "transcript.jsonl", '{"uuid":"prompt"}\n');
    const path = f.hook("Stop");
    const uploaded = statSync(f.transcript).size;
    await expect(
      upload(f.directory, "/nonexistent-test-shim.js", path, f.config, {
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
    f.hook("SessionEnd");
    await upload(f.directory, "/nonexistent-test-shim.js", path, f.config, {
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
