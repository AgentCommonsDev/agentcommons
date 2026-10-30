import { execFileSync } from "node:child_process";
import { appendFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { IngestEnvelope } from "@agentcommons/core/schemas/ingest";
import { hash, writeAtomic } from "../src/files.js";
import { intents, loadState } from "../src/state.js";
import { upload } from "../src/upload.js";
import { fixture, SHIM, stubFetch } from "./fixture.js";

/** How many completed intent ids a state remembers in `processed`. */
const PROCESSED = 512;
type Verdict = "SESSION_OWNED" | "SESSION_PURGED";
/**
 * The ingest batch rule (§5.1): a batch id the server already holds replays its receipt at
 * the same cursor and is a `BATCH_CONFLICT` at any other. A `verdict` answers every batch of
 * the native session it names.
 */
function server(verdict?: { code: Verdict; sessionId: string }) {
  const receipts = new Map<string, string>();
  const received: IngestEnvelope[] = [];
  const fetch = stubFetch((body) => {
    received.push(body);
    if (verdict?.sessionId === body.harnessSessionId)
      return Response.json(
        { code: verdict.code, message: "Rejected." },
        { status: 409 },
      );
    const prior = receipts.get(body.batchId);
    if (prior !== undefined && prior !== body.cursor)
      return Response.json(
        {
          code: "BATCH_CONFLICT",
          message: "This batch ID was already used for a different upload.",
        },
        { status: 409 },
      );
    receipts.set(body.batchId, body.cursor);
    return new Response(null, { status: 202 });
  });
  /** The record keys accepted for one native session. */
  const keys = (sessionId: string) =>
    received
      .filter((body) => body.harnessSessionId === sessionId)
      .flatMap((body) => body.records.map((record) => record.key));
  return { fetch, received, receipts, keys };
}
type Server = ReturnType<typeof server>;
const unavailable = stubFetch(() => new Response(null, { status: 503 }));
/** A Claude Code session in a git checkout, as real sessions are, and its uploader. */
function session() {
  const f = fixture();
  execFileSync("git", ["init", "--quiet"], { cwd: f.directory });
  const drain = (fetch: typeof globalThis.fetch, path: string, sweep = false) =>
    upload(f.directory, SHIM, path, f.config, {
      fetch,
      sweep,
      sleep: () => Promise.resolve(),
      update: false,
      recall: false,
      policy: false,
    });
  const append = (uuid: string) => {
    appendFileSync(f.transcript, `${JSON.stringify({ uuid })}\n`);
  };
  return { ...f, drain, append };
}
/**
 * The state a long session reaches by its first compaction: more turns have completed since
 * the start than `processed` remembers, so the start's id has left it.
 */
function laterTurnsCompleted(path: string): void {
  const state = loadState(path);
  writeAtomic(path, {
    ...state,
    processed: Array.from({ length: PROCESSED }, (_, index) =>
      hash(`turn-${String(index)}`),
    ),
  });
}
const starts = (api: Server) =>
  api.received.filter((body) => body.behavior === "start");

// @req R-CAP-31
it("records a compaction's SessionStart as its own event and keeps uploading after it", async () => {
  const s = session();
  const api = server();
  const path = s.hook({ hook_event_name: "SessionStart", source: "startup" });
  await s.drain(api.fetch, path);
  laterTurnsCompleted(path);
  s.append("compact-boundary");
  // Both callbacks of the one compaction observe the same transcript and coalesce.
  s.hook({ hook_event_name: "SessionStart" });
  s.hook({ hook_event_name: "SessionStart" });
  s.append("after-compaction");
  s.hook();
  await s.drain(api.fetch, path);
  const state = loadState(path);
  expect(state.suspended).toBeNull();
  const [startup, compaction] = starts(api);
  expect(starts(api)).toHaveLength(2);
  expect(compaction?.batchId).not.toBe(startup?.batchId);
  expect(compaction?.sourcePos).toBeGreaterThan(startup?.sourcePos ?? 0);
  expect(api.keys(s.event.session_id)).toContain("after-compaction");
  expect(state.ackedCursor).toEqual({
    kind: "jsonl",
    offset: statSync(s.transcript).size,
  });
  expect(intents(path, state)).toHaveLength(0);
});

// @req R-CAP-31 @req R-CAP-07
it("completes a duplicate start delivered after its event's receipt moved past its cursor", async () => {
  const s = session();
  const api = server();
  const path = s.hook({ hook_event_name: "SessionStart", source: "startup" });
  await s.drain(api.fetch, path);
  // A second callback of the same start lands after the drain and waits out `processed`.
  s.hook({ hook_event_name: "SessionStart", source: "startup" });
  laterTurnsCompleted(path);
  await s.drain(api.fetch, path);
  const [first, duplicate] = starts(api);
  expect(duplicate?.batchId).toBe(first?.batchId);
  expect(duplicate?.cursor).not.toBe(first?.cursor);
  expect(api.receipts.get(first?.batchId ?? "")).toBe(first?.cursor);
  expect(loadState(path).suspended).toBeNull();
  expect(intents(path, loadState(path))).toHaveLength(0);
  s.append("later");
  s.hook();
  await s.drain(api.fetch, path);
  expect(api.keys(s.event.session_id)).toContain("later");
});

// @req R-CAP-07 @req R-ING-10
it.each(["SESSION_OWNED", "SESSION_PURGED"] as const)(
  "suspends the session on a 409 %s and sends nothing more",
  async (code) => {
    const s = session();
    const api = server({ code, sessionId: s.event.session_id });
    const path = s.hook({ hook_event_name: "SessionStart" });
    await s.drain(api.fetch, path);
    const state = loadState(path);
    expect(state.suspended).toEqual({
      code: 409,
      reason: `The server rejected this session (${code}).`,
    });
    expect(state.pending).not.toBeNull();
    s.hook();
    await s.drain(api.fetch, path);
    expect(api.received).toHaveLength(1);
  },
);

/**
 * The state an earlier bundle left behind: the compaction's start went out under a batch id
 * the server already held at another cursor, and the 409 parked the session with its start
 * pending and its later turns journaled.
 */
async function parkedByEarlierBundle() {
  const s = session();
  const path = s.hook({ hook_event_name: "SessionStart", source: "startup" });
  await s.drain(server().fetch, path);
  s.append("compact-boundary");
  s.hook({ hook_event_name: "SessionStart" });
  s.append("after-compaction");
  s.hook();
  await s.drain(unavailable, path);
  const parked = loadState(path);
  if (parked.pending?.mode !== "lifecycle")
    throw new Error("The compaction start must be pending.");
  writeAtomic(path, {
    ...parked,
    suspended: { code: 409, reason: "The server rejected this session." },
  });
  // The session has ended: only another session's uploader reaches it, through the sweep.
  const transcript = join(s.directory, "other.jsonl");
  writeFileSync(transcript, `${JSON.stringify({ uuid: "other" })}\n`);
  const other = s.hook({
    session_id: randomUUID(),
    transcript_path: transcript,
  });
  return { ...s, path, other, batchId: parked.pending.batchId };
}

// @req R-CAP-07
it("resumes a session an earlier bundle parked on a batch conflict, through another session's sweep", async () => {
  const s = await parkedByEarlierBundle();
  const api = server();
  // The startup's receipt holds the compaction start's batch id, at the startup's cursor.
  api.receipts.set(s.batchId, JSON.stringify({ kind: "jsonl", offset: 0 }));
  await s.drain(api.fetch, s.other, true);
  const state = loadState(s.path);
  expect(state.suspended).toBeNull();
  expect(state.pending).toBeNull();
  const resent = api.received.find(
    (body) => body.harnessSessionId === s.event.session_id,
  );
  expect(resent?.batchId).toBe(s.batchId);
  expect(api.keys(s.event.session_id)).toEqual([
    "compact-boundary",
    "after-compaction",
  ]);
  expect(state.ackedCursor).toEqual({
    kind: "jsonl",
    offset: statSync(s.transcript).size,
  });
  expect(intents(s.path, state)).toHaveLength(0);
});

// @req R-CAP-07
it("parks a resumed session again when the server's verdict is genuine", async () => {
  const s = await parkedByEarlierBundle();
  const api = server({ code: "SESSION_OWNED", sessionId: s.event.session_id });
  await s.drain(api.fetch, s.other, true);
  expect(loadState(s.path).suspended).toEqual({
    code: 409,
    reason: "The server rejected this session (SESSION_OWNED).",
  });
  const sent = api.received.length;
  await s.drain(api.fetch, s.other, true);
  expect(
    api.received
      .slice(sent)
      .filter((body) => body.harnessSessionId === s.event.session_id),
  ).toHaveLength(0);
});
