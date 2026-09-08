import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  statSync,
  appendFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { configure, install } from "../src/install.js";
import { HARNESSES } from "../src/harnesses.js";
import { readSource, initialCursor } from "../src/readers.js";
import { recordHook } from "../src/hook.js";
import { acquireLock } from "../src/lock.js";
import { intents, loadState } from "../src/state.js";
import { upload } from "../src/upload.js";
import {
  ingestEnvelopeSchema,
  type IngestEnvelope,
} from "@agentcommons/core/schemas/ingest";

function setup() {
  const directory = mkdtempSync(join(tmpdir(), "agentcommons-hook-test-"));
  const config = configure(directory, {
    server: "http://localhost:3000",
    key: "test-credential",
    node: process.execPath,
  });
  const transcript = join(directory, "transcript.jsonl");
  writeFileSync(transcript, '{"uuid":"one","type":"user"}\n');
  const event = {
    session_id: randomUUID(),
    transcript_path: transcript,
    cwd: directory,
    hook_event_name: "Stop",
  };
  const path = recordHook(
    directory,
    "/nonexistent-test-shim.js",
    config,
    "claude",
    event,
    "test-launch",
  );
  if (!path) throw new Error("Expected a recorded event.");
  return { directory, config, transcript, event, path };
}
function fakeFetch(
  handle: (body: IngestEnvelope) => Response | Promise<Response>,
): typeof fetch {
  return async (_url, options) =>
    options?.method !== "POST"
      ? Response.json({
          organization: { id: "019939c0-0000-7000-8000-000000000001" },
        })
      : handle(
          ingestEnvelopeSchema.parse(
            JSON.parse(
              typeof options.body === "string" ? options.body : "null",
            ) as unknown,
          ),
        );
}
describe("durable uploader", () => {
  // @req R-CAP-05 @req R-CAP-14
  it("resends the exact pending batch after termination before or after server acceptance", async () => {
    for (const killpoint of ["persisted", "accepted"] as const) {
      const fixture = setup();
      const received: IngestEnvelope[] = [];
      const fetcher = fakeFetch((body) => {
        received.push(body);
        return new Response(null, { status: 202 });
      });
      await expect(
        upload(
          fixture.directory,
          "/nonexistent-test-shim.js",
          fixture.path,
          fixture.config,
          {
            fetch: fetcher,
            sweep: false,
            checkpoint: (point) =>
              point === killpoint
                ? Promise.reject(new Error("interrupted"))
                : Promise.resolve(),
          },
        ),
      ).rejects.toThrow("interrupted");
      const interrupted = loadState(fixture.path);
      expect(interrupted.ackedCursor).toEqual({ kind: "jsonl", offset: 0 });
      const pending = interrupted.pending;
      if (!pending) throw new Error("Pending must survive.");
      const bytes = readFileSync(pending.file, "utf8");
      expect(statSync(pending.file).mode & 0o777).toBe(0o600);
      expect(statSync(join(fixture.directory, "spool")).mode & 0o777).toBe(
        0o700,
      );
      expect(statSync(join(fixture.directory, "state")).mode & 0o777).toBe(
        0o700,
      );
      await upload(
        fixture.directory,
        "/nonexistent-test-shim.js",
        fixture.path,
        fixture.config,
        { fetch: fetcher, sweep: false },
      );
      expect(received.at(-1)).toEqual(JSON.parse(bytes));
      expect(loadState(fixture.path).ackedCursor).toEqual({
        kind: "jsonl",
        offset: statSync(fixture.transcript).size,
      });
      expect(loadState(fixture.path).pending).toBeNull();
      expect(statSync(fixture.path).mode & 0o777).toBe(0o600);
    }
  });
  // @req R-CAP-07 @req R-ING-10
  it("backs off without advancing the cursor and suspends rejected credentials", async () => {
    const fixture = setup();
    const delays: number[] = [];
    const ids: string[] = [];
    await upload(
      fixture.directory,
      "/nonexistent-test-shim.js",
      fixture.path,
      fixture.config,
      {
        sweep: false,
        fetch: fakeFetch((body) => {
          ids.push(body.batchId);
          return new Response(null, { status: 503 });
        }),
        sleep: (delay) => {
          delays.push(delay);
          return Promise.resolve();
        },
      },
    );
    expect(delays).toEqual([1000, 5000, 30000]);
    expect(new Set(ids).size).toBe(1);
    expect(loadState(fixture.path).ackedCursor).toEqual({
      kind: "jsonl",
      offset: 0,
    });
    await upload(
      fixture.directory,
      "/nonexistent-test-shim.js",
      fixture.path,
      fixture.config,
      {
        sweep: false,
        fetch: fakeFetch(() => new Response(null, { status: 401 })),
      },
    );
    expect(loadState(fixture.path).suspended?.code).toBe(401);
    expect(
      readFileSync(join(fixture.directory, "hook.log"), "utf8"),
    ).not.toContain(fixture.config.key);
  });
  // @req R-CAP-07 @req R-ING-10
  it("quarantines malformed records before acknowledgment and retries an unpaired result after later source progress", async () => {
    const fixture = setup();
    const received: IngestEnvelope[] = [];
    let rejected = false;
    const fetcher = fakeFetch((body) => {
      received.push(body);
      if (!rejected && body.records.length) {
        rejected = true;
        return Response.json(
          { code: "UNPAIRED_TOOL_RESULT", detail: { records: [{ pos: 0 }] } },
          { status: 422 },
        );
      }
      return new Response(null, { status: 202 });
    });
    await upload(
      fixture.directory,
      "/nonexistent-test-shim.js",
      fixture.path,
      fixture.config,
      { sweep: false, fetch: fetcher },
    );
    expect(received.map((body) => body.records.length)).toEqual([1, 0]);
    appendFileSync(fixture.transcript, '{"uuid":"two","type":"assistant"}\n');
    recordHook(
      fixture.directory,
      "/nonexistent-test-shim.js",
      fixture.config,
      "claude",
      fixture.event,
      "test-launch",
    );
    await upload(
      fixture.directory,
      "/nonexistent-test-shim.js",
      fixture.path,
      fixture.config,
      { sweep: false, fetch: fetcher },
    );
    expect(received.slice(2).map((body) => body.records[0]?.key)).toEqual([
      "two",
      "one",
    ]);
    expect(loadState(fixture.path).pending).toBeNull();
  });
  // @req R-CAP-07 @req R-ING-10
  it("splits rejected batches while committing each prefix cursor separately", async () => {
    const fixture = setup();
    appendFileSync(
      fixture.transcript,
      '{"uuid":"two"}\n{"uuid":"three"}\n{"uuid":"four"}\n',
    );
    const accepted: number[] = [];
    await upload(
      fixture.directory,
      "/nonexistent-test-shim.js",
      fixture.path,
      fixture.config,
      {
        sweep: false,
        fetch: fakeFetch((body) => {
          if (body.records.length > 1)
            return new Response(null, { status: 413 });
          accepted.push(...body.records.map((record) => record.pos));
          return new Response(null, { status: 202 });
        }),
      },
    );
    expect(accepted).toHaveLength(4);
    expect(new Set(accepted).size).toBe(4);
    expect(loadState(fixture.path).ackedCursor).toEqual({
      kind: "jsonl",
      offset: statSync(fixture.transcript).size,
    });
  });
  // @req R-CAP-06
  it("captures an intent published during a network request and coalesces duplicate resume deliveries", async () => {
    const fixture = setup();
    const received: IngestEnvelope[] = [];
    await upload(
      fixture.directory,
      "/nonexistent-test-shim.js",
      fixture.path,
      fixture.config,
      {
        sweep: false,
        fetch: fakeFetch((body) => {
          received.push(body);
          if (received.length === 1)
            for (let index = 0; index < 2; index++)
              recordHook(
                fixture.directory,
                "/nonexistent-test-shim.js",
                fixture.config,
                "claude",
                {
                  ...fixture.event,
                  hook_event_name: "SessionStart",
                  source: "resume",
                },
                "second-launch",
              );
          return new Response(null, { status: 202 });
        }),
      },
    );
    expect(received.filter((body) => body.start?.resume)).toHaveLength(1);
    expect(intents(fixture.path, loadState(fixture.path))).toHaveLength(0);
  });
  // @req R-CAP-04
  it("allows one live owner and reclaims a dead owner's token", async () => {
    const fixture = setup();
    const path = `${fixture.path}.owner`;
    const first = await acquireLock(path);
    expect(first).not.toBeNull();
    expect(await acquireLock(path)).toBeNull();
    first?.release();
    writeFileSync(
      path,
      JSON.stringify({
        pid: 2147483647,
        birth: "dead",
        since: Date.now(),
        token: randomUUID(),
      }),
      { mode: 0o600 },
    );
    const next = await acquireLock(path);
    expect(next).not.toBeNull();
    next?.release();
  });
});
describe("source readers and installer", () => {
  // @req R-CAP-10
  it("holds incomplete UTF-8 JSONL tails and tracks changed document records by source version", () => {
    const fixture = setup();
    writeFileSync(fixture.transcript, '{"uuid":"one","text":"é"}\n{"uuid":');
    const first = readSource(
      fixture.transcript,
      initialCursor(HARNESSES.claude),
      HARNESSES.claude,
      0,
    );
    expect(first.records).toHaveLength(1);
    expect(first.cursor).toEqual({
      kind: "jsonl",
      offset: Buffer.byteLength('{"uuid":"one","text":"é"}\n'),
    });
    appendFileSync(fixture.transcript, '"two"}\n');
    expect(
      readSource(fixture.transcript, first.cursor, HARNESSES.claude, 0)
        .records[0]?.key,
    ).toBe("two");
    writeFileSync(
      fixture.transcript,
      JSON.stringify({
        sessionId: "native",
        messages: [{ id: "a", content: "first" }],
      }),
    );
    const document = readSource(
      fixture.transcript,
      initialCursor(HARNESSES.gemini),
      HARNESSES.gemini,
      0,
    );
    expect(
      readSource(fixture.transcript, document.cursor, HARNESSES.gemini, 0)
        .records,
    ).toHaveLength(0);
    writeFileSync(
      fixture.transcript,
      JSON.stringify({
        sessionId: "native",
        messages: [{ id: "a", content: "changed" }, { id: "b" }],
      }),
    );
    const changed = readSource(
      fixture.transcript,
      document.cursor,
      HARNESSES.gemini,
      0,
    );
    expect(changed.records.map((record) => record.sourceVersion)).toEqual([
      1, 0,
    ]);
    expect(changed.transcriptMetadata).toEqual({
      sessionId: "native",
      sourceRecordCount: 2,
    });
  });
  // @req R-INST-02 @req R-INST-04
  it("preserves settings, replaces exact markers, and keeps installation identity through reinstall and uninstall", () => {
    const fixture = setup();
    const home = join(fixture.directory, "native");
    install(fixture.directory, fixture.config, {
      configHome: home,
      noShellRc: true,
      harnesses: ["claude", "codex", "gemini", "pi"],
    });
    const path = join(home, ".claude/settings.json");
    const original = JSON.parse(readFileSync(path, "utf8")) as {
      hooks: Record<string, unknown[]>;
      unrelated?: string;
    };
    original.unrelated = "preserve";
    original.hooks.Stop?.push({
      hooks: [{ command: "other-agentcommons-hook-name" }],
    });
    writeFileSync(path, JSON.stringify(original));
    install(fixture.directory, fixture.config, {
      configHome: home,
      noShellRc: true,
      harnesses: ["claude", "codex", "gemini", "pi"],
    });
    const again = configure(fixture.directory, {
      key: "replacement-credential",
    });
    expect(again.installationId).toBe(fixture.config.installationId);
    install(
      fixture.directory,
      again,
      {
        configHome: home,
        noShellRc: true,
        harnesses: ["claude", "codex", "gemini", "pi"],
      },
      true,
    );
    const text = readFileSync(path, "utf8");
    expect(text).toContain("preserve");
    expect(text).toContain("other-agentcommons-hook-name");
    expect(text).not.toContain('agentcommons-hook"');
    expect(statSync(join(fixture.directory, "config.json")).mode & 0o777).toBe(
      0o600,
    );
  });
});

// @req R-CAP-07 @req R-ING-10
it.each([429, 500, 503, 401, 403, 409, 0])(
  "keeps pending bytes for HTTP %i or network failure",
  async (status) => {
    const f = setup();
    const delays: number[] = [];
    const request = fakeFetch(() => {
      if (status === 0) throw new Error("network unavailable");
      return new Response(null, { status });
    });
    await upload(f.directory, "/none", f.path, f.config, {
      fetch: request,
      sweep: false,
      sleep: (delay) => {
        delays.push(delay);
        return Promise.resolve();
      },
    });
    const state = loadState(f.path);
    expect(state.pending).not.toBeNull();
    expect(state.ackedCursor).toEqual({ kind: "jsonl", offset: 0 });
    if ([401, 403, 409].includes(status))
      expect(state.suspended?.code).toBe(status);
    else expect(delays).toEqual([1000, 5000, 30000]);
  },
);
