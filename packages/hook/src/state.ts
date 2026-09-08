import { existsSync, statSync } from "node:fs";
import { arch, hostname, platform, userInfo } from "node:os";
import { basename, dirname, join } from "node:path";
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
  removeFile,
  secureDirectory,
  writeExclusive,
} from "./files.js";
import { HARNESSES, cliHarnessSchema, type CliHarness } from "./harnesses.js";
import { cursorSchema, initialCursor } from "./readers.js";

const snapshotSchema = z.strictObject({
  signature: z.string().nullable(),
  size: z.number().int().nonnegative(),
  watermark: z.number().int().nonnegative(),
});
type Snapshot = z.infer<typeof snapshotSchema>;
const contextSchema = ingestContextSchema;
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
  behavior: z.enum(["start", "sync", "end"]),
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
  suspended: z
    .strictObject({ code: z.number(), reason: z.string() })
    .nullable(),
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
export const batchIdForIntent = (id: string): string =>
  uuidv5(id, "d078f527-c096-5a14-9f6a-d49280722491");
export function loadState(path: string): HookState {
  return readJson(path, stateSchema);
}
function readIntent(file: string): Intent | null {
  try {
    return readJson(file, intentSchema);
  } catch (error) {
    if (isCode(error, "ENOENT")) return null;
    throw error;
  }
}
function orderedUnique(
  items: Intent[],
  processed: readonly string[],
): Intent[] {
  const seen = new Set(processed);
  return items
    .sort(
      (a, b) => a.sentAt.localeCompare(b.sentAt) || a.id.localeCompare(b.id),
    )
    .filter((intent) => {
      if (seen.has(intent.id)) return false;
      seen.add(intent.id);
      return true;
    });
}
export function intents(path: string, state: HookState): Intent[] {
  return orderedUnique(
    jsonFiles(journalPath(path)).flatMap((file) => {
      const intent = readIntent(file);
      return intent ? [intent] : [];
    }),
    state.processed,
  );
}
export function publishIntent(path: string, intent: Intent): void {
  const watermark = String(intent.source.watermark).padStart(16, "0");
  const timestamp = String(Date.parse(intent.sentAt)).padStart(16, "0");
  writeExclusive(
    join(
      journalPath(path),
      `${watermark}.${timestamp}.${intent.behavior}.${intent.id}.json`,
    ),
    intent,
  );
}
export function removeIntent(path: string, id: string): void {
  for (const file of jsonFiles(journalPath(path)))
    if (basename(file) === `${id}.json` || file.endsWith(`.${id}.json`))
      removeFile(file);
}
/** Read only the highest source and latest lifecycle observations on the hook path. */
export function recentIntents(path: string, state: HookState): Intent[] {
  const processed = new Set(state.processed);
  const selected = new Map<string, { file: string; order: string }>();
  const legacy: Intent[] = [];
  const choose = (kind: string, file: string, order: string): void => {
    const existing = selected.get(kind);
    if (!existing || order > existing.order)
      selected.set(kind, { file, order });
  };
  for (const file of jsonNames(journalPath(path))) {
    const parts =
      /^(\d{16})\.(\d{16})\.(start|sync|end)\.([a-f0-9]{64})\.json$/.exec(file);
    if (!parts) {
      const intent = readIntent(join(journalPath(path), file));
      if (intent) legacy.push(intent);
      continue;
    }
    const [, watermark, timestamp, kind, id] = parts;
    if (!watermark || !timestamp || !kind || !id || processed.has(id)) continue;
    choose("source", file, `${watermark}.${timestamp}.${id}`);
    if (kind !== "sync") choose(kind, file, `${timestamp}.${id}`);
  }
  return orderedUnique(
    [...new Set([...selected.values()].map(({ file }) => file))]
      .flatMap((file) => {
        const intent = readIntent(join(journalPath(path), file));
        return intent ? [intent] : [];
      })
      .concat(legacy),
    state.processed,
  );
}
export function snapshot(
  path: string | null,
  previous: Snapshot,
  reader: "jsonl-append" | "json-document",
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
