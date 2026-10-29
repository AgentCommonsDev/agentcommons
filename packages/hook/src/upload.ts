import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import * as z from "zod";
import {
  ingestEnvelopeSchema,
  type HookIdentity,
  type IngestEnvelope,
} from "@agentcommons/core/schemas/ingest";
import type { HookConfig } from "./config.js";
import {
  hash,
  isCode,
  jsonFiles,
  readJson,
  removeFile,
  writeAtomic,
} from "./files.js";
import {
  CredentialRejected,
  credentialOrganization,
  rejectionCode,
  rejectionConfirmed,
} from "./identity.js";
import { gitContext, gitEnd } from "./git.js";
import { HARNESSES, type HarnessDefinition } from "./harnesses.js";
import { spawnUpload } from "./hook.js";
import { acquireLock, MAX_UPLOADER_MS, type Lock } from "./lock.js";
import { note } from "./paths.js";
import { flushToolPolicyViolations, refreshToolPolicy } from "./policy-sync.js";
import { refreshRecallHint } from "./recall.js";
import { hookIdentity, reconcileInstall, selfUpdate } from "./update.js";
import {
  OversizedSourceRecord,
  quarantineOversized,
  prefixCursor,
  readSource,
  type SourceRead,
} from "./readers.js";
import {
  batchIdForIntent,
  ensureState,
  headIntent,
  highestSourceEntry,
  intentById,
  journalEntries,
  publishIntent,
  readEntry,
  removeIntent,
  latestSource,
  loadState,
  ownerPath,
  quarantinePath,
  snapshot,
  statePath,
  stateSchema,
  type HookState,
  type Intent,
  type Pending,
} from "./state.js";

const rejectionSchema = z.looseObject({
  code: z.string(),
  detail: z
    .looseObject({
      records: z.array(
        z.looseObject({
          pos: z.union([z.number(), z.string()]),
          key: z.string().nullable().optional(),
        }),
      ),
    })
    .optional(),
});
const deferredSchema = z.strictObject({
  envelope: ingestEnvelopeSchema,
  afterGeneration: z.number().int().nonnegative(),
  retryable: z.boolean(),
});
type Deferred = z.infer<typeof deferredSchema>;
const splitSchema = z.strictObject({
  envelope: ingestEnvelopeSchema,
  pending: z.unknown(),
});
interface UploadOptions {
  fetch?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  checkpoint?: (
    point: "persisted" | "accepted" | "acknowledged",
    state: HookState,
  ) => Promise<void>;
  sweep?: boolean;
  update?: boolean;
  /** Refresh the repository's recall hint cache after the drain (§6.2); tests turn it off. */
  recall?: boolean;
  /** Refresh the cached tool policy and flush blocked/warned telemetry (§6.4); tests turn it off. */
  policy?: boolean;
}
interface DrainResult {
  readonly children: readonly string[];
  readonly retry: boolean;
  readonly settle: boolean;
}
/** A drain that found nothing to do or must not proceed. */
const IDLE: DrainResult = { children: [], retry: false, settle: false };
/** Turn-end hooks (`settle` in HARNESSES) can fire before the harness appends its
 * final record. After such a drain the uploader polls the source every 250 ms until
 * it has been quiet for 2 s, never more than 5 s per drain, so the final message
 * ships in this run rather than at the next hook. Acknowledgment never waits on it. */
export const SETTLE_POLL_MS = 250;
export const SETTLE_QUIET_POLLS = 8;
export const SETTLE_MAX_POLLS = 20;
function save(path: string, state: HookState, lock: Lock): void {
  lock.assertOwned();
  writeAtomic(path, state);
}
/** Stops this session until the credential or server changes (§6.2 upload step 3). */
function suspend(
  directory: string,
  path: string,
  state: HookState,
  lock: Lock,
  code: number,
  reason: string,
): void {
  state.suspended = { code, reason };
  save(path, state, lock);
  note(
    directory,
    `Upload paused (HTTP ${String(code)}). Run hook.js doctor after updating the configuration.`,
  );
}
function cleanupAcknowledged(path: string, state: HookState, lock: Lock): void {
  if (!state.cleanup.files.length && !state.cleanup.intents.length) return;
  lock.assertOwned();
  for (const file of state.cleanup.files) removeFile(file);
  for (const id of state.cleanup.intents) removeIntent(path, id);
  state.cleanup = { files: [], intents: [] };
  save(path, state, lock);
}
function finishIntent(state: HookState, intent: Intent | undefined): void {
  if (!intent) return;
  state.processed = [
    ...state.processed.filter((id) => id !== intent.id),
    intent.id,
  ].slice(-512);
  if (intent.behavior !== "sync")
    state.phase = {
      kind: intent.behavior,
      id: intent.id,
      preceding: intent.preceding,
    };
  state.intent = "none";
  // The journal is removed only after the state containing processed is committed.
}
function envelope(
  config: HookConfig,
  identity: HookIdentity,
  definition: HarnessDefinition,
  state: HookState,
  intent: Intent | undefined,
  source: SourceRead | undefined,
): IngestEnvelope {
  const behavior = source ? "sync" : (intent?.behavior ?? "sync");
  return ingestEnvelopeSchema.parse({
    envelopeVersion: 2,
    hook: identity,
    harness: definition.id,
    harnessSessionId: state.sessionId,
    behavior,
    nativeEvent: intent?.nativeEvent ?? "source_flush",
    start: behavior === "start" ? { resume: intent?.resume ?? false } : null,
    batchId: intent && !source ? batchIdForIntent(intent.id) : randomUUID(),
    installationId: config.installationId,
    sentAt: intent && !source ? intent.sentAt : state.contextSentAt,
    sourcePos:
      source?.sourcePos ?? intent?.source.watermark ?? state.source.watermark,
    context: {
      ...state.context,
      ...(source?.transcriptMetadata
        ? { transcriptMetadata: source.transcriptMetadata }
        : {}),
    },
    records: source?.records ?? [],
    cursor: JSON.stringify(source?.cursor ?? state.ackedCursor),
    end:
      behavior === "end"
        ? gitEnd(
            state.context.cwd,
            state.context.git?.head ?? null,
            intent?.reason ?? null,
          )
        : null,
  });
}
interface Sent {
  response: Response;
  /** The server's error code of a confirmed 401/403 (§6.2 step 3); its body is consumed. */
  rejection: string | null;
}
/**
 * Sends the pending bytes with the 1/5/30 s backoff. A 429, 5xx, network failure and an
 * unconfirmed 401/403 (no API error code in the body, or a confirmation `GET /api/v1/me`
 * that did not reach a verdict) are retried alike; three failures leave `pending` in place.
 */
async function send(
  config: HookConfig,
  body: string,
  options: UploadOptions,
): Promise<Sent | null> {
  const fetcher = options.fetch ?? fetch;
  for (const delay of [1000, 5000, 30000]) {
    try {
      const response = await fetcher(new URL("/api/v1/ingest", config.server), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${config.key}`,
        },
        body,
        signal: AbortSignal.timeout(30_000),
      });
      if ([401, 403].includes(response.status)) {
        const code = await rejectionCode(response);
        if (
          code !== null &&
          (await rejectionConfirmed(config, response.status, fetcher))
        )
          return { response, rejection: code };
      } else if (response.status !== 429 && response.status < 500)
        return { response, rejection: null };
      else await response.body?.cancel();
    } catch {
      /* The exact pending bytes are retried after transport failures. */
    }
    await (options.sleep ?? sleep)(delay);
  }
  return null;
}
/** Writes the spool file and persists it as the session's single pending batch. */
function prepare(
  directory: string,
  path: string,
  state: HookState,
  body: IngestEnvelope,
  pending: Omit<Pending, "batchId" | "file">,
  lock: Lock,
): void {
  const file = join(directory, "spool", `${body.batchId}.json`);
  writeAtomic(file, body);
  state.pending = { ...pending, batchId: body.batchId, file };
  save(path, state, lock);
}
function registerChildren(
  directory: string,
  state: HookState,
  definition: HarnessDefinition,
  intent: Intent,
  config: HookConfig,
): void {
  for (const child of intent.children) {
    const childPath = statePath(directory, state.harness, child.sessionId);
    ensureState(
      childPath,
      state.harness,
      child.sessionId,
      child.transcriptPath,
      state.context.cwd,
      config,
    );
    const childIntent: Intent = {
      ...intent,
      id: hash(`${intent.id}:${child.sessionId}`),
      sessionId: child.sessionId,
      transcriptPath: child.transcriptPath,
      source:
        child.source ??
        snapshot(
          child.transcriptPath,
          { signature: null, size: 0, watermark: 0 },
          definition.reader,
        ),
      behavior: definition.events[intent.nativeEvent]?.childBehavior ?? "sync",
      resume: false,
      children: [],
      context: {
        ...intent.context,
        parentHint: {
          harnessSessionId: state.sessionId,
          relation: "SUBAGENT",
          ...(child.agentType ? { agentType: child.agentType } : {}),
        },
      },
    };
    publishIntent(childPath, childIntent);
    if (!state.children.includes(childPath)) state.children.push(childPath);
  }
}
function pendingBase(
  state: HookState,
  mode: Pending["mode"],
  intentId: string | null,
  source = state.source,
): Omit<Pending, "batchId" | "file"> {
  return {
    mode,
    intentId,
    source,
    cursorStart: state.ackedCursor,
    cursorEnd: state.ackedCursor,
    deferredFiles: [],
    remainderFile: null,
  };
}
function observeContext(state: HookState, intent: Intent): boolean {
  if (Date.parse(intent.sentAt) < Date.parse(state.contextSentAt)) return false;
  const held = JSON.stringify(state.context);
  const context = {
    ...state.context,
    ...intent.context,
    git: state.context.git,
  };
  if (
    intent.sentAt === state.contextSentAt &&
    (intent.transcriptPath ?? state.transcriptPath) === state.transcriptPath &&
    JSON.stringify(context) === held
  )
    return false;
  // Start context observes HEAD as of the start hook, not the drain time. Repeated
  // drains of a dormant child reuse that observation instead of probing git again.
  context.git ??= gitContext(intent.context.cwd, intent.sentAt);
  state.context = context;
  state.contextSentAt = intent.sentAt;
  state.transcriptPath = intent.transcriptPath ?? state.transcriptPath;
  return JSON.stringify(state.context) !== held;
}
/** A stop alone does not prove a child transcript exists (ADR0097). Keep its
 * immutable intent until bytes appear, without publishing an empty remote child. */
function undiscoveredChild(
  state: HookState,
  intent: Intent | undefined,
  observed: HookState["source"],
): boolean {
  return (
    intent?.behavior === "end" &&
    intent.context.parentHint?.relation === "SUBAGENT" &&
    state.lastSyncAt === 0 &&
    state.phase === null &&
    observed.watermark === 0
  );
}
function childObservation(
  state: HookState,
  entries: ReturnType<typeof journalEntries>,
): HookState["source"] {
  const highest = highestSourceEntry(entries);
  const latest = highest ? readEntry(highest) : undefined;
  return snapshot(
    latest?.transcriptPath ?? state.transcriptPath,
    latestSource(state, latest ? [latest] : []),
    HARNESSES[state.harness].reader,
  );
}
/** Dormant child ends neither consume the sweep slot nor respawn an uploader.
 * Their intent remains on disk, so source growth makes them eligible again. */
function hasWork(path: string, state: HookState): boolean {
  if (state.pending) return true;
  const entries = journalEntries(path, state.processed);
  const observed = childObservation(state, entries);
  if (
    entries.every((entry) => entry.kind === "end") &&
    undiscoveredChild(state, headIntent(entries), observed)
  )
    return false;
  return entries.length > 0 || observed.signature !== state.source.signature;
}
async function drain(
  directory: string,
  identity: HookIdentity,
  path: string,
  config: HookConfig,
  options: UploadOptions,
  settle = false,
): Promise<DrainResult> {
  const lock = await acquireLock(ownerPath(path));
  if (!lock) return IDLE;
  const deadline = setTimeout(() => process.exit(0), MAX_UPLOADER_MS);
  deadline.unref();
  let state: HookState;
  try {
    state = loadState(path);
  } catch (error) {
    // A state file this bundle cannot read: release the owner so the next uploader is
    // not left recovering a dead one, log why the session stays silent, serve the rest.
    clearTimeout(deadline);
    lock.release();
    note(
      directory,
      `Session state unreadable, skipped: ${path}: ${error instanceof Error ? (error.message.split("\n")[0] ?? "") : "unknown error"}`,
    );
    return IDLE;
  }
  const definition = HARNESSES[state.harness];
  const wait = options.sleep ?? sleep;
  let retry = false;
  let stoppedSource: string | null = null;
  // A first pass never waits: children registered by this drain are flushed before
  // the caller comes back for the settle pass, so a subagent's final record is not
  // delayed behind its parent's quiet window.
  let settleRequested = false;
  let settlePolls = 0;
  const waitForChange = async (
    observed: HookState["source"],
    retained: ReadonlySet<string> = new Set(),
  ): Promise<boolean> => {
    for (
      let quiet = 0;
      settle && quiet < SETTLE_QUIET_POLLS && settlePolls < SETTLE_MAX_POLLS;
      quiet++
    ) {
      settlePolls++;
      await wait(SETTLE_POLL_MS);
      const entries = journalEntries(path, state.processed);
      if (
        entries.some((entry) => !retained.has(entry.id)) ||
        (retained.size
          ? childObservation(state, entries)
          : snapshot(state.transcriptPath, observed, definition.reader)
        ).signature !== observed.signature
      )
        return true;
    }
    return false;
  };
  // Rejected records awaiting replay, listed once and again only after the set changes.
  let quarantined: { file: string; item: Deferred }[] | null = null;
  const replayable = (): { file: string; item: Deferred } | undefined => {
    quarantined ??= jsonFiles(quarantinePath(path)).map((file) => ({
      file,
      item: readJson(file, deferredSchema),
    }));
    return quarantined.find(
      ({ item }) =>
        item.retryable && item.afterGeneration < state.retryGeneration,
    );
  };
  try {
    cleanupAcknowledged(path, state, lock);
    if (state.suspended && state.credentialHash === hash(config.key))
      return IDLE;
    // A state belongs to its original server. A credential/server switch must not leak its spool.
    if (
      new URL(state.server).origin !== new URL(config.server).origin ||
      (config.organizationId !== null &&
        state.organizationId !== null &&
        state.organizationId !== config.organizationId)
    ) {
      suspend(
        directory,
        path,
        state,
        lock,
        409,
        "The server or organization changed.",
      );
      return IDLE;
    }
    if (!state.organizationId || state.credentialHash !== hash(config.key)) {
      let organizationId: string;
      try {
        organizationId = await credentialOrganization(
          config,
          options.fetch ?? fetch,
        );
      } catch (error) {
        // A rejection sticks to this credential only once confirmed by a second verdict
        // (§6.2 step 3); a server that could not answer leaves the spool for the next hook.
        if (
          error instanceof CredentialRejected &&
          (error.status === 409 ||
            (error.code !== null &&
              (await rejectionConfirmed(
                config,
                error.status,
                options.fetch ?? fetch,
              ))))
        ) {
          state.credentialHash = hash(config.key);
          suspend(
            directory,
            path,
            state,
            lock,
            error.status,
            `The server rejected this credential${error.code ? ` (${error.code})` : ""}.`,
          );
          return IDLE;
        }
        return { ...IDLE, retry: true };
      }
      if (state.organizationId && state.organizationId !== organizationId) {
        suspend(
          directory,
          path,
          state,
          lock,
          409,
          "The credential belongs to another organization.",
        );
        return IDLE;
      }
      state.organizationId = organizationId;
      state.credentialHash = hash(config.key);
      state.suspended = null;
      save(path, state, lock);
    }
    for (;;) {
      // Filenames index the journal (§6.2): a pass reads only the head intent and, for
      // the source snapshot, the entry with the highest watermark.
      const entries = journalEntries(path, state.processed);
      if (!state.pending) {
        const intent = headIntent(entries);
        // Whether this intent carries context the server does not hold yet (§6.2 step 2).
        let contextChanged = false;
        let firstObservation = false;
        if (intent) {
          firstObservation =
            Date.parse(intent.sentAt) > Date.parse(state.contextSentAt);
          contextChanged = observeContext(state, intent);
          state.intent = intent.behavior === "end" ? "end" : "sync";
          settleRequested ||=
            definition.events[intent.nativeEvent]?.settle === true;
          registerChildren(directory, state, definition, intent, config);
        }
        const childSource =
          intent?.behavior === "end" &&
          intent.context.parentHint?.relation === "SUBAGENT" &&
          entries.every((entry) => entry.kind === "end")
            ? childObservation(state, entries)
            : null;
        if (childSource && undiscoveredChild(state, intent, childSource)) {
          // All retained source watermarks are zero, so the highest entry is
          // also the newest end. A corrected path gets its own settle window.
          const newestEntry = highestSourceEntry(entries);
          const newest = newestEntry ? readEntry(newestEntry) : undefined;
          if (newest) {
            firstObservation ||=
              Date.parse(newest.sentAt) > Date.parse(state.contextSentAt);
            observeContext(state, newest);
          }
          // Save the observed context time before waiting. Later parent callbacks
          // do not spend another settle window on this same missing child.
          settleRequested = firstObservation;
          save(path, state, lock);
          if (
            await waitForChange(
              childSource,
              new Set(entries.map((entry) => entry.id)),
            )
          )
            continue;
          break;
        }
        if (intent && intent.behavior !== "sync")
          prepare(
            directory,
            path,
            state,
            envelope(config, identity, definition, state, intent, undefined),
            pendingBase(state, "lifecycle", intent.id, intent.source),
            lock,
          );
        else {
          const replay = replayable();
          if (replay) {
            const body = {
              ...replay.item.envelope,
              batchId: randomUUID(),
              behavior: "sync" as const,
              start: null,
              end: null,
              sentAt: state.contextSentAt,
              cursor: JSON.stringify(state.ackedCursor),
              context: state.context,
            };
            prepare(
              directory,
              path,
              state,
              body,
              {
                ...pendingBase(state, "deferred", null),
                deferredFiles: [replay.file],
              },
              lock,
            );
          } else {
            const highest = highestSourceEntry(entries);
            const waiting = [
              intent,
              highest && highest.id !== intent?.id
                ? readEntry(highest)
                : undefined,
            ].flatMap((item) => (item ? [item] : []));
            const observed = snapshot(
              state.transcriptPath,
              latestSource(state, waiting),
              definition.reader,
            );
            let read: SourceRead | undefined;
            if (
              state.transcriptPath &&
              (intent || observed.signature !== stoppedSource)
            ) {
              try {
                read = readSource(
                  state.transcriptPath,
                  state.ackedCursor,
                  definition,
                  observed.watermark,
                );
              } catch (error) {
                if (error instanceof OversizedSourceRecord)
                  read = quarantineOversized(
                    error,
                    state.ackedCursor,
                    observed.watermark,
                    join(quarantinePath(path), "raw"),
                  );
                else if (!isCode(error, "ENOENT")) throw error;
              }
            }
            if (
              read &&
              (read.records.length ||
                JSON.stringify(read.cursor) !==
                  JSON.stringify(state.ackedCursor))
            ) {
              prepare(
                directory,
                path,
                state,
                envelope(config, identity, definition, state, intent, read),
                {
                  ...pendingBase(state, "source", intent?.id ?? null, {
                    ...observed,
                    watermark: read.sourcePos,
                  }),
                  cursorEnd: read.cursor,
                },
                lock,
              );
            } else if (intent && !contextChanged) {
              // Nothing past ackedCursor and a context the server already holds: the
              // intent completes without a request, so the end batch never queues
              // behind empty syncs (§6.2 step 2). Cursors stay unchanged.
              finishIntent(state, intent);
              state.source = observed;
              state.cleanup = { files: [], intents: [intent.id] };
              save(path, state, lock);
              cleanupAcknowledged(path, state, lock);
              stoppedSource = observed.signature;
              continue;
            } else if (intent) {
              // Context-only tree changes still need a server projection; source cursors stay unchanged.
              prepare(
                directory,
                path,
                state,
                envelope(config, identity, definition, state, intent, {
                  records: [],
                  cursor: state.ackedCursor,
                  sourcePos: intent.source.watermark,
                }),
                pendingBase(state, "source", intent.id, intent.source),
                lock,
              );
              stoppedSource = observed.signature;
            } else {
              stoppedSource = observed.signature;
              // Everything read so far is acknowledged; only wait for a late final record.
              if (await waitForChange(observed)) continue;
              break;
            }
          }
        }
      }
      const pending = state.pending;
      if (!pending) break;
      await options.checkpoint?.("persisted", state);
      const bodyText = readFileSync(pending.file, "utf8");
      const body = ingestEnvelopeSchema.parse(JSON.parse(bodyText) as unknown);
      const sent = await send(config, bodyText, options);
      if (!sent) {
        retry = true;
        break;
      }
      const { response, rejection } = sent;
      if (response.status === 202) {
        await response.body?.cancel();
        await options.checkpoint?.("accepted", state);
        state.ackedCursor = pending.cursorEnd;
        state.source = pending.source;
        state.lastSyncAt = Date.now();
        if (pending.mode === "source") state.retryGeneration++;
        const acknowledged =
          pending.intentId === null
            ? undefined
            : intentById(entries, pending.intentId);
        finishIntent(state, acknowledged);
        state.pending = null;
        if (pending.remainderFile) {
          const remaining = readJson(pending.remainderFile, splitSchema);
          // Validate the saved continuation with the same state schema used on startup.
          const validated = stateSchema.parse({
            ...state,
            pending: remaining.pending,
          }).pending;
          if (!validated) throw new Error("Missing split continuation.");
          state.pending = validated;
          writeAtomic(validated.file, remaining.envelope);
        }
        state.cleanup = {
          files: [
            pending.file,
            ...pending.deferredFiles,
            ...(pending.remainderFile ? [pending.remainderFile] : []),
          ],
          intents: acknowledged ? [acknowledged.id] : [],
        };
        save(path, state, lock);
        await options.checkpoint?.("acknowledged", state);
        // Replayed quarantine files leave the set with this cleanup.
        if (pending.deferredFiles.length) quarantined = null;
        cleanupAcknowledged(path, state, lock);
        continue;
      }
      if (response.status === 409) {
        const code = await rejectionCode(response);
        if (code === "BATCH_CONFLICT" && pending.mode === "lifecycle") {
          // A lifecycle batch id is its event's identity, so the server already holds this
          // event's receipt, taken at another cursor (§6.2 step 3): the intent is complete.
          // Nothing is acknowledged; the cursors stay where they are.
          const recorded =
            pending.intentId === null
              ? undefined
              : intentById(entries, pending.intentId);
          finishIntent(state, recorded);
          state.pending = null;
          state.cleanup = {
            files: [pending.file],
            intents: recorded ? [recorded.id] : [],
          };
          save(path, state, lock);
          cleanupAcknowledged(path, state, lock);
          continue;
        }
        // Any other 409 is the server's verdict on the session.
        suspend(
          directory,
          path,
          state,
          lock,
          409,
          `The server rejected this session (${code ?? "no error code"}).`,
        );
        break;
      }
      // A 401/403 arrives here only confirmed.
      if (rejection !== null) {
        suspend(
          directory,
          path,
          state,
          lock,
          response.status,
          `The server rejected this session or credential (${rejection}).`,
        );
        break;
      }
      if (response.status === 413 && body.records.length > 1) {
        await response.body?.cancel();
        const at = Math.ceil(body.records.length / 2);
        const selected = body.records.slice(0, at);
        const rest = body.records.slice(at);
        const cursor = prefixCursor(
          pending.cursorStart,
          pending.cursorEnd,
          selected,
          rest,
        );
        const restId = randomUUID();
        const remainderFile = join(
          directory,
          "spool",
          `${restId}.continuation`,
        );
        const restPending: Pending = {
          ...pending,
          batchId: restId,
          file: join(directory, "spool", `${restId}.json`),
          cursorStart: cursor,
        };
        writeAtomic(remainderFile, {
          envelope: { ...body, batchId: restId, records: rest },
          pending: restPending,
        });
        const first = {
          ...body,
          batchId: randomUUID(),
          records: selected,
          cursor: JSON.stringify(cursor),
        };
        prepare(
          directory,
          path,
          state,
          first,
          { ...pending, cursorEnd: cursor, intentId: null, remainderFile },
          lock,
        );
        removeFile(pending.file);
        continue;
      }
      if (
        response.status === 422 ||
        (response.status === 413 && body.records.length === 1)
      ) {
        const rejected =
          response.status === 413
            ? {
                code: "RECORD_TOO_LARGE",
                detail: {
                  records: body.records.map(({ pos, key }) => ({ pos, key })),
                },
              }
            : rejectionSchema.safeParse(await response.json()).data;
        const positions = new Set(
          rejected?.detail?.records.map((record) => String(record.pos)) ?? [],
        );
        const bad = body.records.filter((record) =>
          positions.has(String(record.pos)),
        );
        if (!rejected || !bad.length) {
          retry = true;
          break;
        }
        for (const record of bad) {
          const file = join(
            quarantinePath(path),
            `${hash(JSON.stringify([record.pos, record.sourceVersion, record.key, record.line]))}.json`,
          );
          writeAtomic(file, {
            envelope: { ...body, records: [record] },
            afterGeneration:
              state.retryGeneration + (pending.mode === "source" ? 1 : 0),
            retryable: rejected.code === "UNPAIRED_TOOL_RESULT",
          });
        }
        quarantined = null;
        // Keep old deferred copies until this pending replacement has been committed.
        const next = {
          ...body,
          batchId: randomUUID(),
          records: body.records.filter(
            (record) => !positions.has(String(record.pos)),
          ),
        };
        prepare(
          directory,
          path,
          state,
          next,
          { ...pending, deferredFiles: [] },
          lock,
        );
        removeFile(pending.file);
        continue;
      }
      await response.body?.cancel();
      retry = true;
      break;
    }
    return { children: state.children, retry, settle: settleRequested };
  } finally {
    clearTimeout(deadline);
    lock.release();
  }
}
/**
 * One uploader run: drains the session, its children and one swept session, refreshes the
 * recall hint, then checks for a bundle update and brings harness wiring in step with
 * the bundle and the CLIs present. The update runs whatever the drain's outcome (a
 * rejected batch, a corrupt state file, an interrupted checkpoint): a stale bundle whose
 * drain fails must still receive the release that fixes it on the machine's next hook.
 */
export async function upload(
  directory: string,
  executable: string,
  path: string,
  config: HookConfig,
  options: UploadOptions = {},
): Promise<void> {
  let retry = false;
  try {
    retry = await drainAll(directory, executable, path, config, options);
  } finally {
    // The served manifest is checked at most hourly; a differing bundle is replaced
    // atomically for the next hook run, and harness wiring is brought in step with the
    // bundle and the CLIs present. Failures never reach the durability path.
    if (options.update !== false) {
      const updateOptions = options.fetch ? { fetch: options.fetch } : {};
      await selfUpdate(directory, executable, config, updateOptions);
      await reconcileInstall(directory, executable, config, updateOptions);
    }
  }
  // Tool policy (ADR 0080, §6.4), independent of any session state so a pre-tool hook's
  // respawn refreshes and flushes even a session that never wrote a transcript: refresh the
  // cached org policy the offline hook enforces, then send the spooled blocked/warned
  // decisions. Both are throttled, best effort and never throw.
  if (options.policy !== false) {
    const policyOptions = options.fetch ? { fetch: options.fetch } : {};
    await refreshToolPolicy(directory, config, policyOptions);
    await flushToolPolicyViolations(directory, config, policyOptions);
  }
  // Covers a hook that published while the old owner was exiting. Hooks arriving
  // after this check see no owner and start their own uploader.
  let current: HookState;
  try {
    current = loadState(path);
  } catch {
    return; // Unreadable state: the drain logged it; nothing to respawn for.
  }
  if (
    !retry &&
    !current.suspended &&
    journalEntries(path, current.processed).length &&
    hasWork(path, current)
  )
    spawnUpload(config, executable, path);
}
/** Drains every session this run covers; true when a send failed and the next hook retries it. */
async function drainAll(
  directory: string,
  executable: string,
  path: string,
  config: HookConfig,
  options: UploadOptions,
): Promise<boolean> {
  const visited = new Set<string>();
  const queue = [path];
  const settling: string[] = [];
  let retry = false;
  const identity = hookIdentity(directory, executable);
  // Every session and child is drained once without waiting; settle passes follow.
  while (queue.length || settling.length) {
    const current = queue.shift();
    const settle = current === undefined;
    const target = current ?? settling.shift();
    if (target === undefined || (!settle && visited.has(target))) continue;
    if (!settle) visited.add(target);
    const result = await drain(
      directory,
      identity,
      target,
      config,
      options,
      settle,
    );
    retry ||= result.retry;
    queue.push(...result.children);
    // A failed send already waits for its backoff; the next hook retries it instead.
    if (result.settle && !settle && !result.retry) settling.push(target);
  }
  if (options.sweep !== false) {
    const candidate = jsonFiles(join(directory, "state"))
      .filter((file) => !visited.has(file))
      // An unreadable state file never blocks the other sessions' sweep; its own uploader logs it.
      .flatMap((file) => {
        try {
          return [{ file, state: loadState(file) }];
        } catch {
          return [];
        }
      })
      .filter(({ file, state }) => !state.suspended && hasWork(file, state))
      .sort((a, b) => a.state.lastSyncAt - b.state.lastSyncAt)[0];
    if (candidate)
      await drain(directory, identity, candidate.file, config, {
        ...options,
        sweep: false,
      });
  }
  // The session's checkout root, as the first drain recorded it; the recall refresh
  // reads the checkout's current `origin` from it (`repositoryAt`),
  // never the recorded URL. An unreadable state was already logged by its drain and has
  // no repository to serve.
  let git: HookState["context"]["git"] = null;
  try {
    git = loadState(path).context.git;
  } catch {
    return retry;
  }
  // The session's repository count is refreshed at most every 15 minutes so the next
  // prompt hook answers from the cache without a request (§6.2 recall hint).
  if (options.recall !== false)
    await refreshRecallHint(
      directory,
      config,
      git,
      options.fetch ? { fetch: options.fetch } : {},
    );
  return retry;
}
