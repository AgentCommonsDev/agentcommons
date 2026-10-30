import { existsSync, statSync } from "node:fs";
import { arch, hostname, platform, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { v5 as uuidv5 } from "uuid";
import * as z from "zod";
import { ingestContextSchema } from "@agentcommons/core/schemas/ingest-context";
import type { HookConfig } from "./config.js";
import {
  hash,
  isCode,
  jsonFiles,
  jsonNames,
  readJson,
  readJsonOr,
  removeFile,
  secureDirectory,
  writeExclusive,
} from "./files.js";
import {
  HARNESSES,
  cliHarnessSchema,
  type CliHarness,
  type ReaderKind,
} from "./harnesses.js";
import { cursorSchema, initialCursor } from "./readers.js";

const snapshotSchema = z.strictObject({
  signature: z.string().nullable(),
  size: z.number().int().nonnegative(),
  watermark: z.number().int().nonnegative(),
});
type Snapshot = z.infer<typeof snapshotSchema>;
const contextSchema = ingestContextSchema;
const behaviorSchema = z.enum(["start", "sync", "end"]);
const phaseSchema = z
  .strictObject({
    kind: z.enum(["start", "end"]),
    id: z.string(),
    preceding: z.string(),
  })
  .nullable();
export const intentSchema = z.strictObject({
  v: z.literal(1),
  id: z.string(),
  sentAt: z.iso.datetime(),
  harness: cliHarnessSchema,
  sessionId: z.string(),
  transcriptPath: z.string().nullable(),
  behavior: behaviorSchema,
  nativeEvent: z.string(),
  resume: z.boolean(),
  reason: z.string().nullable(),
  context: contextSchema,
  source: snapshotSchema,
  launch: z.string(),
  preceding: z.string(),
  children: z.array(
    z.strictObject({
      sessionId: z.string(),
      transcriptPath: z.string(),
      agentType: z.string().optional(),
      source: snapshotSchema.optional(),
    }),
  ),
});
export type Intent = z.infer<typeof intentSchema>;
const pendingSchema = z.strictObject({
  batchId: z.uuid(),
  file: z.string(),
  cursorStart: cursorSchema,
  cursorEnd: cursorSchema,
  intentId: z.string().nullable(),
  source: snapshotSchema,
  mode: z.enum(["lifecycle", "source", "deferred"]),
  deferredFiles: z.array(z.string()).default([]),
  // Split continuations are unsent source material, not additional in-flight batches.
  remainderFile: z.string().nullable().default(null),
});
/**
 * The reason bundles before ADR 0101 recorded for every ingest 409, whatever its code. Their
 * own lifecycle ids caused `BATCH_CONFLICT`s, which are no verdict, so a state carrying it is
 * read as unsuspended and its pending batch is sent again; a genuine `SESSION_OWNED` or
 * `SESSION_PURGED` suspends it again under a reason that names the code.
 */
const UNCODED_SESSION_REJECTION = "The server rejected this session.";
const suspensionSchema = z
  .strictObject({ code: z.number(), reason: z.string() })
  .nullable()
  .transform((suspended) =>
    suspended?.code === 409 && suspended.reason === UNCODED_SESSION_REJECTION
      ? null
      : suspended,
  );
export const stateSchema = z.strictObject({
  v: z.literal(1),
  harness: cliHarnessSchema,
  sessionId: z.string(),
  transcriptPath: z.string().nullable(),
  server: z.string(),
  organizationId: z.string().nullable(),
  credentialHash: z.string(),
  context: contextSchema,
  contextSentAt: z.iso.datetime().default("1970-01-01T00:00:00.000Z"),
  ackedCursor: cursorSchema,
  source: snapshotSchema,
  pending: pendingSchema.nullable(),
  cleanup: z
    .strictObject({ files: z.array(z.string()), intents: z.array(z.string()) })
    .default({ files: [], intents: [] }),
  intent: z.enum(["none", "sync", "end"]),
  phase: phaseSchema,
  children: z.array(z.string()),
  processed: z.array(z.string()),
  lastSyncAt: z.number(),
  suspended: suspensionSchema,
  retryGeneration: z.number().int().nonnegative(),
});
export type HookState = z.infer<typeof stateSchema>;
export type Pending = z.infer<typeof pendingSchema>;
export function statePath(
  directory: string,
  harness: CliHarness,
  sessionId: string,
): string {
  return join(directory, "state", `${harness}-${hash(sessionId)}.json`);
}
export const journalPath = (path: string): string => `${path}.intents`;
export const ownerPath = (path: string): string => `${path}.owner`;
/** Records the server rejected (422) and, under `raw/`, oversized source bytes (§6.2). */
export const quarantinePath = (path: string): string => `${path}.quarantine`;
export const batchIdForIntent = (id: string): string =>
  uuidv5(id, "d078f527-c096-5a14-9f6a-d49280722491");
export function loadState(path: string): HookState {
  return readJson(path, stateSchema);
}
/** The journal indexes source watermark, event time, kind and intent id in every filename (§6.2). */
const INTENT_FILE =
  /^(\d{16})\.(\d{16})\.(start|sync|end)\.([a-f0-9]{64})\.json$/;
const BEHAVIORS: Readonly<Record<string, Intent["behavior"]>> = {
  start: "start",
  sync: "sync",
  end: "end",
};
export function intentFileName(intent: Intent): string {
  const watermark = String(intent.source.watermark).padStart(16, "0");
  const timestamp = String(Date.parse(intent.sentAt)).padStart(16, "0");
  return `${watermark}.${timestamp}.${intent.behavior}.${intent.id}.json`;
}
interface JournalEntry {
  directory: string;
  name: string;
  watermark: string;
  timestamp: string;
  kind: Intent["behavior"];
  id: string;
}
/** Delivery order: event time, then id. */
const byOrder = (a: JournalEntry, b: JournalEntry): number =>
  a.timestamp < b.timestamp
    ? -1
    : a.timestamp > b.timestamp
      ? 1
      : a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : 0;
/** Source watermark, then delivery order. */
const bySource = (a: JournalEntry, b: JournalEntry): number =>
  a.watermark < b.watermark
    ? -1
    : a.watermark > b.watermark
      ? 1
      : byOrder(a, b);
/**
 * The unprocessed journal from filenames alone, one entry per intent id (a duplicate
 * delivery keeps its earliest copy). No intent is read; callers read the few they need.
 * This runs on the hook path, so it is one pass over the names with no parsing.
 */
export function journalEntries(
  path: string,
  processed: readonly string[],
): JournalEntry[] {
  const directory = journalPath(path);
  const skip = new Set(processed);
  const chosen = new Map<string, JournalEntry>();
  for (const name of jsonNames(directory)) {
    const parts = INTENT_FILE.exec(name);
    if (!parts) continue;
    const [, watermark, timestamp, behavior, id] = parts;
    const kind = behavior === undefined ? undefined : BEHAVIORS[behavior];
    if (!watermark || !timestamp || !kind || !id || skip.has(id)) continue;
    const entry: JournalEntry = {
      directory,
      name,
      watermark,
      timestamp,
      kind,
      id,
    };
    const existing = chosen.get(id);
    if (!existing || byOrder(entry, existing) < 0) chosen.set(id, entry);
  }
  return [...chosen.values()];
}
/** The intent behind an entry, or undefined when its file is gone. */
export function readEntry(entry: JournalEntry): Intent | undefined {
  return readJsonOr(join(entry.directory, entry.name), intentSchema, undefined);
}
function readEntries(entries: readonly JournalEntry[]): Intent[] {
  return [...entries].sort(byOrder).flatMap((entry) => readEntry(entry) ?? []);
}
/** Every unprocessed intent in delivery order; tests and diagnostics only, the uploader reads heads. */
export function intents(path: string, state: HookState): Intent[] {
  return readEntries(journalEntries(path, state.processed));
}
const extreme = (
  entries: readonly JournalEntry[],
  compare: (a: JournalEntry, b: JournalEntry) => number,
  sign: 1 | -1,
): JournalEntry | undefined =>
  entries.reduce<JournalEntry | undefined>(
    (best, entry) =>
      !best || Math.sign(compare(entry, best)) === sign ? entry : best,
    undefined,
  );
/** The next intent to drain: the earliest event, skipping a file that vanished after listing. */
export function headIntent(
  entries: readonly JournalEntry[],
): Intent | undefined {
  const remaining = [...entries];
  for (;;) {
    const head = extreme(remaining, byOrder, -1);
    if (!head) return undefined;
    const intent = readEntry(head);
    if (intent) return intent;
    remaining.splice(remaining.indexOf(head), 1);
  }
}
/** The entry observing the highest source watermark; the latest event wins a tie. */
export function highestSourceEntry(
  entries: readonly JournalEntry[],
): JournalEntry | undefined {
  return extreme(entries, bySource, 1);
}
export function intentById(
  entries: readonly JournalEntry[],
  id: string,
): Intent | undefined {
  const entry = entries.find((candidate) => candidate.id === id);
  return entry ? readEntry(entry) : undefined;
}
export function publishIntent(path: string, intent: Intent): void {
  writeExclusive(join(journalPath(path), intentFileName(intent)), intent);
}
export function removeIntent(path: string, id: string): void {
  for (const file of jsonFiles(journalPath(path)))
    if (file.endsWith(`.${id}.json`)) removeFile(file);
}
/** Read only the highest source and latest lifecycle observations on the hook path. */
export function recentIntents(path: string, state: HookState): Intent[] {
  const entries = journalEntries(path, state.processed);
  const latest = (kind: Intent["behavior"]) =>
    extreme(
      entries.filter((entry) => entry.kind === kind),
      byOrder,
      1,
    );
  const picks = [highestSourceEntry(entries), latest("start"), latest("end")];
  return readEntries([
    ...new Set(picks.flatMap((entry) => (entry ? [entry] : []))),
  ]);
}
export function snapshot(
  path: string | null,
  previous: Snapshot,
  reader: ReaderKind,
): Snapshot {
  if (!path) return previous;
  try {
    const stat = statSync(path, { bigint: true });
    const size = Number(stat.size);
    if (!Number.isSafeInteger(size))
      throw new Error("The transcript is too large to address safely.");
    const signature = `${String(stat.dev)}:${String(stat.ino)}:${String(stat.size)}:${String(stat.mtimeNs)}`;
    return {
      signature,
      size,
      watermark:
        reader === "json-document" && signature !== previous.signature
          ? Math.max(previous.watermark + 1, size)
          : Math.max(previous.watermark, size),
    };
  } catch (error) {
    if (isCode(error, "ENOENT")) return previous;
    throw error;
  }
}
export function latestSource(
  state: HookState,
  waiting: readonly Intent[],
): Snapshot {
  return [
    state.source,
    ...(state.pending ? [state.pending.source] : []),
    ...waiting.map((intent) => intent.source),
  ].reduce((latest, item) =>
    item.watermark >= latest.watermark ? item : latest,
  );
}
export function latestPhase(
  state: HookState,
  waiting: readonly Intent[],
): HookState["phase"] {
  let phase = state.phase;
  for (const intent of waiting)
    if (intent.behavior !== "sync")
      phase = {
        kind: intent.behavior,
        id: intent.id,
        preceding: intent.preceding,
      };
  return phase;
}
function installation(): HookState["context"]["installation"] {
  let osUser = "";
  try {
    osUser = userInfo().username;
  } catch {
    /* Some service users have no passwd entry. */
  }
  return { hostname: hostname(), osUser, platform: platform(), arch: arch() };
}
export function ensureState(
  path: string,
  harness: CliHarness,
  sessionId: string,
  transcriptPath: string | null,
  cwd: string,
  config: HookConfig,
): HookState {
  if (existsSync(path)) return loadState(path);
  secureDirectory(dirname(path));
  writeExclusive(path, {
    v: 1,
    harness,
    sessionId,
    transcriptPath,
    server: config.server,
    organizationId: config.organizationId,
    credentialHash: config.credentialHash ?? "",
    context: { cwd, installation: installation(), git: null, parentHint: null },
    ackedCursor: initialCursor(HARNESSES[harness]),
    source: { signature: null, size: 0, watermark: 0 },
    pending: null,
    intent: "none",
    phase: null,
    children: [],
    processed: [],
    lastSyncAt: 0,
    suspended: null,
    retryGeneration: 0,
  });
  return loadState(path);
}
