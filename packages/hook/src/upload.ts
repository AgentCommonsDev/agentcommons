import { randomUUID } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
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
  secureDirectory,
  writeAtomic,
} from "./files.js";
import { CredentialRejected, credentialOrganization } from "./identity.js";
import { gitContext, gitEnd } from "./git.js";
import { HARNESSES } from "./harnesses.js";
import { spawnUpload } from "./hook.js";
import { acquireLock, MAX_UPLOADER_MS, type Lock } from "./lock.js";
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
  intents,
  publishIntent,
  removeIntent,
  latestSource,
  loadState,
  ownerPath,
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
}
const pause = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
/** Turn-end hooks (`settle` in HARNESSES) can fire before the harness appends its
 * final record. After such a drain the uploader polls the source every 250 ms until
 * it has been quiet for 2 s, never more than 5 s per drain, so the final message
 * ships in this run rather than at the next hook. Acknowledgment never waits on it. */
const SETTLE_POLL_MS = 250;
const SETTLE_QUIET_POLLS = 8;
const SETTLE_MAX_POLLS = 20;
function log(directory: string, code: number): void {
  secureDirectory(directory);
  appendFileSync(
    join(directory, "hook.log"),
    `${new Date().toISOString()} Upload paused (HTTP ${String(code)}). Run hook.js doctor after updating the configuration.\n`,
    { mode: 0o600 },
  );
}
function save(path: string, state: HookState, lock: Lock): void {
  lock.assertOwned();
  writeAtomic(path, state);
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
  state: HookState,
  intent: Intent | undefined,
  source: SourceRead | undefined,
): IngestEnvelope {
  const behavior = source ? "sync" : (intent?.behavior ?? "sync");
  return ingestEnvelopeSchema.parse({
    envelopeVersion: 2,
    hook: identity,
    harness: HARNESSES[state.harness].id,
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
async function send(
  config: HookConfig,
  body: string,
  options: UploadOptions,
): Promise<Response | null> {
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
      if (response.status !== 429 && response.status < 500) return response;
      await response.body?.cancel();
    } catch {
      /* The exact pending bytes are retried after transport failures. */
    }
    await (options.sleep ?? pause)(delay);
  }
  return null;
}
function prepare(
  directory: string,
  path: string,
  state: HookState,
  body: IngestEnvelope,
  pending: Omit<Pending, "batchId" | "file">,
  lock: Lock,
): Pending {
  const file = join(directory, "spool", `${body.batchId}.json`);
  writeAtomic(file, body);
  state.pending = { ...pending, batchId: body.batchId, file };
  save(path, state, lock);
  return state.pending;
}
function registerChildren(
  directory: string,
  state: HookState,
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
          HARNESSES[state.harness].reader,
        ),
      behavior:
        HARNESSES[state.harness].events[intent.nativeEvent]?.childBehavior ??
        "sync",
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
async function drain(
  directory: string,
  identity: HookIdentity,
  path: string,
  config: HookConfig,
  options: UploadOptions,
  settle = false,
): Promise<{ children: string[]; retry: boolean; settle: boolean }> {
  const lock = await acquireLock(ownerPath(path));
  if (!lock) return { children: [], retry: false, settle: false };
  const deadline = setTimeout(() => process.exit(0), MAX_UPLOADER_MS);
  deadline.unref();
  const state = loadState(path);
  let retry = false;
  let stoppedSource: string | null = null;
  // A first pass never waits: children registered by this drain are flushed before
  // the caller comes back for the settle pass, so a subagent's final record is not
  // delayed behind its parent's quiet window.
  let settleRequested = false;
  let settlePolls = 0;
  try {
    cleanupAcknowledged(path, state, lock);
    if (state.suspended && state.credentialHash === hash(config.key))
      return { children: [], retry: false, settle: false };
    // A state belongs to its original server. A credential/server switch must not leak its spool.
    if (
      new URL(state.server).origin !== new URL(config.server).origin ||
      (config.organizationId !== null &&
        state.organizationId !== null &&
        state.organizationId !== config.organizationId)
    ) {
      state.suspended = {
        code: 409,
        reason: "The server or organization changed.",
      };
      save(path, state, lock);
      log(directory, 409);
      return { children: [], retry: false, settle: false };
    }
    if (!state.organizationId || state.credentialHash !== hash(config.key)) {
      let organizationId: string;
      try {
        organizationId = await credentialOrganization(
          config,
          options.fetch ?? fetch,
        );
      } catch (error) {
        if (
          error instanceof CredentialRejected &&
          [401, 403, 409].includes(error.status)
        ) {
          state.suspended = {
            code: error.status,
            reason: "The server rejected this credential.",
          };
          state.credentialHash = hash(config.key);
          save(path, state, lock);
          log(directory, error.status);
          return { children: [], retry: false, settle: false };
        }
        throw error;
      }
      if (state.organizationId && state.organizationId !== organizationId) {
        state.suspended = {
          code: 409,
          reason: "The credential belongs to another organization.",
        };
        save(path, state, lock);
        log(directory, 409);
        return { children: [], retry: false, settle: false };
      }
      state.organizationId = organizationId;
      state.credentialHash = hash(config.key);
      state.suspended = null;
      save(path, state, lock);
    }
    for (;;) {
      const waiting = intents(path, state);
      const intent = waiting[0];
      if (!state.pending) {
        if (intent) {
          if (Date.parse(intent.sentAt) >= Date.parse(state.contextSentAt)) {
            state.context = {
              ...state.context,
              ...intent.context,
              // Start context observes HEAD as of the start hook, not the drain time.
              git:
                state.context.git ??
                gitContext(intent.context.cwd, intent.sentAt),
            };
            state.contextSentAt = intent.sentAt;
            state.transcriptPath =
              intent.transcriptPath ?? state.transcriptPath;
          }
          state.intent = intent.behavior === "end" ? "end" : "sync";
          settleRequested ||=
            HARNESSES[state.harness].events[intent.nativeEvent]?.settle ===
            true;
          registerChildren(directory, state, intent, config);
          if (intent.behavior !== "sync") {
            state.pending = prepare(
              directory,
              path,
              state,
              envelope(config, identity, state, intent, undefined),
              pendingBase(state, "lifecycle", intent.id, intent.source),
              lock,
            );
          }
        }
        if (!state.pending) {
          const deferred = jsonFiles(`${path}.quarantine`)
            .map((file) => ({ file, item: readJson(file, deferredSchema) }))
            .find(
              ({ item }) =>
                item.retryable && item.afterGeneration < state.retryGeneration,
            );
          if (deferred) {
            const body = {
              ...deferred.item.envelope,
              batchId: randomUUID(),
              behavior: "sync" as const,
              start: null,
              end: null,
              sentAt: state.contextSentAt,
              cursor: JSON.stringify(state.ackedCursor),
              context: state.context,
            };
            state.pending = prepare(
              directory,
              path,
              state,
              body,
              {
                ...pendingBase(state, "deferred", null),
                deferredFiles: [deferred.file],
              },
              lock,
            );
          } else {
            const observed = snapshot(
              state.transcriptPath,
              latestSource(state, waiting),
              HARNESSES[state.harness].reader,
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
                  HARNESSES[state.harness],
                  observed.watermark,
                );
              } catch (error) {
                if (error instanceof OversizedSourceRecord)
                  read = quarantineOversized(
                    error,
                    state.ackedCursor,
                    observed.watermark,
                    `${path}.quarantine/raw`,
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
              state.pending = prepare(
                directory,
                path,
                state,
                envelope(config, identity, state, intent, read),
                {
                  ...pendingBase(state, "source", intent?.id ?? null, {
                    ...observed,
                    watermark: read.sourcePos,
                  }),
                  cursorEnd: read.cursor,
                },
                lock,
              );
            } else if (intent) {
              // Context-only tree changes still need a server projection; source cursors stay unchanged.
              state.pending = prepare(
                directory,
                path,
                state,
                envelope(config, identity, state, intent, {
                  records: [],
                  cursor: state.ackedCursor,
                  sourcePos: intent.source.watermark,
                  complete: true,
                }),
                pendingBase(state, "source", intent.id, intent.source),
                lock,
              );
              stoppedSource = observed.signature;
            } else {
              stoppedSource = observed.signature;
              // Everything read so far is acknowledged; only wait for a late final record.
              let grew = false;
              for (
                let quiet = 0;
                settle &&
                quiet < SETTLE_QUIET_POLLS &&
                settlePolls < SETTLE_MAX_POLLS;
                quiet++
              ) {
                settlePolls++;
                await (options.sleep ?? pause)(SETTLE_POLL_MS);
                if (
                  intents(path, state).length ||
                  snapshot(
                    state.transcriptPath,
                    observed,
                    HARNESSES[state.harness].reader,
                  ).signature !== observed.signature
                ) {
                  grew = true;
                  break;
                }
              }
              if (grew) continue;
              break;
            }
          }
        }
      }
      const pending = state.pending;
      await options.checkpoint?.("persisted", state);
      const bodyText = readFileSync(pending.file, "utf8");
      const body = ingestEnvelopeSchema.parse(JSON.parse(bodyText) as unknown);
      const response = await send(config, bodyText, options);
      if (!response) {
        retry = true;
        break;
      }
      if (response.status === 202) {
        await response.body?.cancel();
        await options.checkpoint?.("accepted", state);
        state.ackedCursor = pending.cursorEnd;
        state.source = pending.source;
        state.lastSyncAt = Date.now();
        if (pending.mode === "source") state.retryGeneration++;
        const acknowledged = waiting.find(
          (item) => item.id === pending.intentId,
        );
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
        cleanupAcknowledged(path, state, lock);
        continue;
      }
      if ([401, 403, 409].includes(response.status)) {
        state.suspended = {
          code: response.status,
          reason: "The server rejected this session or credential.",
        };
        save(path, state, lock);
        log(directory, response.status);
        await response.body?.cancel();
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
        state.pending = prepare(
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
            `${path}.quarantine`,
            `${hash(JSON.stringify([record.pos, record.sourceVersion, record.key, record.line]))}.json`,
          );
          writeAtomic(file, {
            envelope: { ...body, records: [record] },
            afterGeneration:
              state.retryGeneration + (pending.mode === "source" ? 1 : 0),
            retryable: rejected.code === "UNPAIRED_TOOL_RESULT",
          });
        }
        // Keep old deferred copies until this pending replacement has been committed.
        const next = {
          ...body,
          batchId: randomUUID(),
          records: body.records.filter(
            (record) => !positions.has(String(record.pos)),
          ),
        };
        state.pending = prepare(
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
export async function upload(
  directory: string,
  executable: string,
  path: string,
  config: HookConfig,
  options: UploadOptions = {},
): Promise<void> {
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
      .map((file) => ({ file, state: loadState(file) }))
      .filter(
        ({ file, state }) =>
          !state.suspended &&
          (state.pending ||
            intents(file, state).length ||
            snapshot(
              state.transcriptPath,
              state.source,
              HARNESSES[state.harness].reader,
            ).signature !== state.source.signature),
      )
      .sort((a, b) => a.state.lastSyncAt - b.state.lastSyncAt)[0];
    if (candidate)
      await drain(directory, identity, candidate.file, config, {
        ...options,
        sweep: false,
      });
  }
  // The served manifest is checked at most hourly; a differing bundle is replaced
  // atomically for the next hook run, and harness wiring is brought in step with the
  // bundle and the CLIs present. Failures never reach the durability path.
  if (options.update !== false) {
    const updateOptions = options.fetch ? { fetch: options.fetch } : {};
    await selfUpdate(directory, executable, config, updateOptions);
    await reconcileInstall(directory, executable, config, updateOptions);
  }
  // Covers a hook that published while the old owner was exiting. Hooks arriving
  // after this check see no owner and start their own uploader.
  const current = loadState(path);
  if (!retry && !current.suspended && intents(path, current).length)
    spawnUpload(config, executable, path);
}
