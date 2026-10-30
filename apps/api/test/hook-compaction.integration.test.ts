import { randomUUID } from "node:crypto";
import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { ingestEnvelopeSchema, type IngestEnvelope } from "@agentcommons/core";
import { requireCaller } from "../src/services/context.js";
import { configSchema } from "../../../packages/hook/src/config.js";
import { hash, writeAtomic } from "../../../packages/hook/src/files.js";
import { recordHook } from "../../../packages/hook/src/hook.js";
import type { NativeHook } from "../../../packages/hook/src/harnesses.js";
import { loadState } from "../../../packages/hook/src/state.js";
import { upload } from "../../../packages/hook/src/upload.js";
import { startTraceDatabase } from "../../../packages/traces/test/support.js";
import { startApp } from "./app.js";
import { provisionOrganization, releaser } from "./support.js";

const SHIM = "/nonexistent-compaction-hook.js";
let db: Awaited<ReturnType<typeof startTraceDatabase>>;
let address: string;
const { defer, release } = releaser();
beforeAll(async () => {
  db = await startTraceDatabase();
  defer(() => db.close());
  const started = await startApp(db, {}, { listen: true });
  defer(() => started.close());
  ({ address } = started);
}, 120_000);
afterAll(release);

const line = (text: string) =>
  `${JSON.stringify({ type: "user", uuid: randomUUID(), message: { content: text } })}\n`;
const options = { update: false, recall: false, policy: false } as const;
/** A Claude Code session the shim's hook and upload modes record on the real server. */
async function session(slug: string) {
  const org = await provisionOrganization(db, `compaction-${slug}`);
  const { organizationId } = requireCaller(org.context);
  const directory = await mkdtemp(join(tmpdir(), "agentcommons-compaction-"));
  defer(() => rm(directory, { recursive: true, force: true }));
  const transcript = join(directory, "session.jsonl");
  await writeFile(transcript, line("Start the investigation"));
  const config = configSchema.parse({
    server: address,
    key: org.key,
    installationId: randomUUID(),
    node: process.execPath,
  });
  const native = randomUUID();
  const sent: { body: IngestEnvelope; status: number }[] = [];
  const network: typeof fetch = async (url, init) => {
    const response = await fetch(url, init);
    if (init?.method === "POST" && typeof init.body === "string")
      sent.push({
        body: ingestEnvelopeSchema.parse(JSON.parse(init.body)),
        status: response.status,
      });
    return response;
  };
  const hook = (overrides: Partial<NativeHook> = {}) => {
    const path = recordHook(directory, SHIM, config, "claude", {
      session_id: native,
      transcript_path: transcript,
      cwd: directory,
      hook_event_name: "Stop",
      ...overrides,
    });
    if (!path) throw new Error("Expected a durable upload intent.");
    return path;
  };
  const drain = (path: string, fetcher: typeof fetch = network) =>
    upload(directory, SHIM, path, config, {
      ...options,
      fetch: fetcher,
      sweep: false,
      sleep: () => Promise.resolve(),
    });
  const receipts = async () => {
    const control = await db.prisma.traceSessionControl.findFirstOrThrow({
      where: { organizationId, harnessSessionId: native },
    });
    return db.prisma.traceReceipt.findMany({
      where: { organizationId, sessionId: control.id },
    });
  };
  const size = async () => Buffer.byteLength(await readFile(transcript));
  return {
    hook,
    drain,
    receipts,
    sent,
    size,
    append: (text: string) => appendFile(transcript, line(text)),
  };
}
/** More turns have completed since the start than `processed` remembers (512). */
function laterTurnsCompleted(path: string): void {
  writeAtomic(path, {
    ...loadState(path),
    processed: Array.from({ length: 512 }, (_, index) =>
      hash(`turn-${String(index)}`),
    ),
  });
}
const starts = (receipts: { behavior: string }[]) =>
  receipts.filter((receipt) => receipt.behavior === "start");
const accepted = (receipts: { acceptedCount: number }[]) =>
  receipts.reduce((total, receipt) => total + receipt.acceptedCount, 0);

// @req R-CAP-31
it("accepts a compaction's SessionStart as its own receipt and keeps uploading after it", async () => {
  const s = await session("start");
  const path = s.hook({ hook_event_name: "SessionStart", source: "startup" });
  await s.drain(path);
  laterTurnsCompleted(path);
  await s.append("Summary of the compacted conversation");
  s.hook({ hook_event_name: "SessionStart" });
  await s.append("Work after the compaction");
  s.hook();
  await s.drain(path);
  const state = loadState(path);
  expect(state.suspended).toBeNull();
  expect(s.sent.map(({ status }) => status)).toEqual([202, 202, 202, 202]);
  const receipts = await s.receipts();
  expect(starts(receipts)).toHaveLength(2);
  expect(accepted(receipts)).toBe(3);
  expect(state.ackedCursor).toEqual({ kind: "jsonl", offset: await s.size() });
});

// @req R-CAP-07 @req R-ING-10
it("resumes a session an earlier bundle parked on the server's BATCH_CONFLICT", async () => {
  const s = await session("parked");
  const path = s.hook({ hook_event_name: "SessionStart", source: "startup" });
  await s.drain(path);
  const startup = s.sent[0]?.body;
  if (startup?.behavior !== "start") throw new Error("Expected the start.");
  await s.append("Summary of the compacted conversation");
  s.hook({ hook_event_name: "SessionStart" });
  await s.append("Work after the compaction");
  s.hook();
  await s.drain(path, () =>
    Promise.resolve(new Response(null, { status: 503 })),
  );
  // An earlier bundle sent the compaction's start under the startup's batch id, met the
  // server's 409 and parked the session with that batch pending.
  const parked = loadState(path);
  if (parked.pending?.mode !== "lifecycle")
    throw new Error("The compaction start must be pending.");
  const pending = ingestEnvelopeSchema.parse(
    JSON.parse(await readFile(parked.pending.file, "utf8")),
  );
  writeAtomic(parked.pending.file, { ...pending, batchId: startup.batchId });
  writeAtomic(path, {
    ...parked,
    pending: { ...parked.pending, batchId: startup.batchId },
    suspended: { code: 409, reason: "The server rejected this session." },
  });
  const before = s.sent.length;
  await s.drain(path);
  const state = loadState(path);
  expect(state.suspended).toBeNull();
  expect(state.pending).toBeNull();
  expect(s.sent[before]).toMatchObject({
    body: { batchId: startup.batchId, behavior: "start" },
    status: 409,
  });
  const receipts = await s.receipts();
  expect(starts(receipts)).toHaveLength(1);
  expect(accepted(receipts)).toBe(3);
  expect(state.ackedCursor).toEqual({ kind: "jsonl", offset: await s.size() });
});
