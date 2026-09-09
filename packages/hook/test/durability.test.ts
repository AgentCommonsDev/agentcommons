import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  statSync,
  appendFileSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { configure, install } from "../src/install.js";
import { HARNESSES } from "../src/harnesses.js";
import { readSource, initialCursor } from "../src/readers.js";
import { acquireLock } from "../src/lock.js";
import { intents, loadState, ownerPath } from "../src/state.js";
import { upload } from "../src/upload.js";
import type { IngestEnvelope } from "@agentcommons/core/schemas/ingest";
import { fixture, SHIM, stubFetch } from "./fixture.js";

afterEach(() => vi.unstubAllEnvs());
/** An installation that has not verified its credential yet, with one Stop intent journaled. */
function setup() {
  const f = fixture({
    initial: '{"uuid":"one","type":"user"}\n',
    config: {
      server: "http://localhost:3000",
      key: "test-credential",
      node: process.execPath,
      organizationId: null,
      credentialHash: null,
    },
  });
  return { ...f, path: f.hook() };
}
describe("durable uploader", () => {
  // @req R-CAP-05 @req R-CAP-14
  it("resends the exact pending batch after termination before or after server acceptance", async () => {
    for (const killpoint of ["persisted", "accepted"] as const) {
      const f = setup();
      const received: IngestEnvelope[] = [];
      const fetcher = stubFetch((body) => {
        received.push(body);
        return new Response(null, { status: 202 });
      });
      await expect(
        upload(f.directory, SHIM, f.path, f.config, {
          fetch: fetcher,
          sweep: false,
          checkpoint: (point) =>
            point === killpoint
              ? Promise.reject(new Error("interrupted"))
              : Promise.resolve(),
        }),
      ).rejects.toThrow("interrupted");
      const interrupted = loadState(f.path);
      expect(interrupted.ackedCursor).toEqual({ kind: "jsonl", offset: 0 });
      const pending = interrupted.pending;
      if (!pending) throw new Error("Pending must survive.");
      const bytes = readFileSync(pending.file, "utf8");
      expect(statSync(pending.file).mode & 0o777).toBe(0o600);
      expect(statSync(join(f.directory, "spool")).mode & 0o777).toBe(0o700);
      expect(statSync(join(f.directory, "state")).mode & 0o777).toBe(0o700);
      await upload(f.directory, SHIM, f.path, f.config, {
        fetch: fetcher,
        sweep: false,
      });
      expect(received.at(-1)).toEqual(JSON.parse(bytes));
      expect(loadState(f.path).ackedCursor).toEqual({
        kind: "jsonl",
        offset: statSync(f.transcript).size,
      });
      expect(loadState(f.path).pending).toBeNull();
      expect(statSync(f.path).mode & 0o777).toBe(0o600);
    }
  });
  // @req R-CAP-07 @req R-ING-10
  it("backs off without advancing the cursor and suspends rejected credentials", async () => {
    const f = setup();
    const delays: number[] = [];
    const ids: string[] = [];
    await upload(f.directory, SHIM, f.path, f.config, {
      sweep: false,
      fetch: stubFetch((body) => {
        ids.push(body.batchId);
        return new Response(null, { status: 503 });
      }),
      sleep: (delay) => {
        delays.push(delay);
        return Promise.resolve();
      },
    });
    expect(delays).toEqual([1000, 5000, 30000]);
    expect(new Set(ids).size).toBe(1);
    expect(loadState(f.path).ackedCursor).toEqual({
      kind: "jsonl",
      offset: 0,
    });
    await upload(f.directory, SHIM, f.path, f.config, {
      sweep: false,
      fetch: stubFetch(() => new Response(null, { status: 401 })),
    });
    expect(loadState(f.path).suspended?.code).toBe(401);
    expect(readFileSync(join(f.directory, "hook.log"), "utf8")).not.toContain(
      f.config.key,
    );
  });
  // @req R-CAP-07 @req R-ING-10
  it("quarantines malformed records before acknowledgment and retries an unpaired result after later source progress", async () => {
    const f = setup();
    const received: IngestEnvelope[] = [];
    let rejected = false;
    const fetcher = stubFetch((body) => {
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
    await upload(f.directory, SHIM, f.path, f.config, {
      sweep: false,
      fetch: fetcher,
    });
    expect(received.map((body) => body.records.length)).toEqual([1, 0]);
    appendFileSync(f.transcript, '{"uuid":"two","type":"assistant"}\n');
    f.hook();
    await upload(f.directory, SHIM, f.path, f.config, {
      sweep: false,
      fetch: fetcher,
    });
    expect(received.slice(2).map((body) => body.records[0]?.key)).toEqual([
      "two",
      "one",
    ]);
    expect(loadState(f.path).pending).toBeNull();
  });
  // @req R-CAP-07 @req R-ING-10
  it("splits rejected batches while committing each prefix cursor separately", async () => {
    const f = setup();
    appendFileSync(
      f.transcript,
      '{"uuid":"two"}\n{"uuid":"three"}\n{"uuid":"four"}\n',
    );
    const accepted: number[] = [];
    await upload(f.directory, SHIM, f.path, f.config, {
      sweep: false,
      fetch: stubFetch((body) => {
        if (body.records.length > 1) return new Response(null, { status: 413 });
        accepted.push(...body.records.map((record) => record.pos));
        return new Response(null, { status: 202 });
      }),
    });
    expect(accepted).toHaveLength(4);
    expect(new Set(accepted).size).toBe(4);
    expect(loadState(f.path).ackedCursor).toEqual({
      kind: "jsonl",
      offset: statSync(f.transcript).size,
    });
  });
  // @req R-CAP-06
  it("captures an intent published during a network request and coalesces duplicate resume deliveries", async () => {
    const f = setup();
    const received: IngestEnvelope[] = [];
    await upload(f.directory, SHIM, f.path, f.config, {
      sweep: false,
      fetch: stubFetch((body) => {
        received.push(body);
        if (received.length === 1)
          for (let index = 0; index < 2; index++)
            f.hook({ hook_event_name: "SessionStart", source: "resume" });
        return new Response(null, { status: 202 });
      }),
    });
    expect(received.filter((body) => body.start?.resume)).toHaveLength(1);
    expect(intents(f.path, loadState(f.path))).toHaveLength(0);
  });
  // @req R-CAP-04
  it("allows one live owner and reclaims a dead owner's token", async () => {
    const f = setup();
    const path = ownerPath(f.path);
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
    const f = setup();
    writeFileSync(f.transcript, '{"uuid":"one","text":"é"}\n{"uuid":');
    const first = readSource(
      f.transcript,
      initialCursor(HARNESSES.claude),
      HARNESSES.claude,
      0,
    );
    expect(first.records).toHaveLength(1);
    expect(first.cursor).toEqual({
      kind: "jsonl",
      offset: Buffer.byteLength('{"uuid":"one","text":"é"}\n'),
    });
    appendFileSync(f.transcript, '"two"}\n');
    expect(
      readSource(f.transcript, first.cursor, HARNESSES.claude, 0).records[0]
        ?.key,
    ).toBe("two");
    writeFileSync(
      f.transcript,
      JSON.stringify({
        sessionId: "native",
        messages: [{ id: "a", content: "first" }],
      }),
    );
    const document = readSource(
      f.transcript,
      initialCursor(HARNESSES.gemini),
      HARNESSES.gemini,
      0,
    );
    expect(
      readSource(f.transcript, document.cursor, HARNESSES.gemini, 0).records,
    ).toHaveLength(0);
    writeFileSync(
      f.transcript,
      JSON.stringify({
        sessionId: "native",
        messages: [{ id: "a", content: "changed" }, { id: "b" }],
      }),
    );
    const changed = readSource(
      f.transcript,
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
    const f = setup();
    const home = join(f.directory, "native");
    // The installer wires every supported CLI it finds on PATH.
    const bin = join(f.directory, "bin");
    mkdirSync(bin);
    for (const name of Object.keys(HARNESSES))
      writeFileSync(join(bin, name), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    vi.stubEnv("PATH", bin);
    const options = { configHome: home, noShellRc: true };
    install(f.directory, f.config, options);
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
    install(f.directory, f.config, options);
    const again = configure(f.directory, { key: "replacement-credential" });
    expect(again.installationId).toBe(f.config.installationId);
    install(f.directory, again, options, true);
    const text = readFileSync(path, "utf8");
    expect(text).toContain("preserve");
    expect(text).toContain("other-agentcommons-hook-name");
    expect(text).not.toContain('agentcommons-hook"');
    expect(statSync(join(f.directory, "config.json")).mode & 0o777).toBe(0o600);
  });
});

// @req R-CAP-07 @req R-ING-10
it.each([429, 500, 503, 401, 403, 409, 0])(
  "keeps pending bytes for HTTP %i or network failure",
  async (status) => {
    const f = setup();
    const delays: number[] = [];
    const request = stubFetch(() => {
      if (status === 0) throw new Error("network unavailable");
      return new Response(null, { status });
    });
    await upload(f.directory, SHIM, f.path, f.config, {
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
