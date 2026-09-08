import * as z from "zod";
import { spawn } from "node:child_process";
import { disabled, type HookConfig } from "./config.js";
import { hash } from "./files.js";
import { HARNESSES, nativeHookSchema, type CliHarness } from "./harnesses.js";
import { liveOwner } from "./lock.js";
import { harnessIdentity } from "./process.js";
import {
  ensureState,
  recentIntents,
  publishIntent,
  latestPhase,
  latestSource,
  ownerPath,
  snapshot,
  statePath,
  type Intent,
} from "./state.js";

export function spawnUpload(
  config: HookConfig,
  executable: string,
  path: string,
): void {
  const child = spawn(config.node, [executable, "upload", path], {
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.on("error", () => {
    /* The durable journal remains available to the next event. */
  });
  child.unref();
}
export function recordHook(
  directory: string,
  executable: string,
  config: HookConfig,
  harness: CliHarness,
  input: unknown,
  launchOverride?: string,
): string | null {
  const event = nativeHookSchema.parse(input);
  const definition = HARNESSES[harness];
  const mapping = definition.events[event.hook_event_name];
  if (!mapping || disabled(config, event.cwd)) return null;
  const path = statePath(directory, harness, event.session_id);
  const state = ensureState(
    path,
    harness,
    event.session_id,
    mapping.parentPath === false ? null : (event.transcript_path ?? null),
    event.cwd,
    config,
  );
  const waiting = recentIntents(path, state);
  const transcriptPath =
    mapping.parentPath === false
      ? state.transcriptPath
      : (event.transcript_path ?? state.transcriptPath);
  const source = snapshot(
    transcriptPath,
    latestSource(state, waiting),
    definition.reader,
  );
  const elapsed = Date.now() - state.lastSyncAt;
  const unread =
    source.size -
    (state.ackedCursor.kind === "jsonl"
      ? state.ackedCursor.offset
      : state.source.size);
  if (
    mapping.behavior === "sync" &&
    !mapping.always &&
    !mapping.child &&
    (!config.realtime ||
      (elapsed < config.syncIntervalSeconds * 1000 &&
        unread < config.syncBytesThreshold))
  )
    return path;
  const identity =
    launchOverride ?? JSON.stringify(harnessIdentity(definition));
  const phase = latestPhase(state, waiting);
  const preceding =
    phase?.kind === mapping.behavior
      ? phase.preceding
      : (phase?.id ?? "initial");
  const nativeId = event.tool_use_id ?? event.prompt_id ?? event.turn_id ?? "";
  const id = hash(
    JSON.stringify([
      harness,
      event.session_id,
      identity,
      event.hook_event_name,
      event.event_id ?? preceding,
      event.event_id
        ? null
        : mapping.behavior === "sync"
          ? [nativeId, event.agent_id, source.signature, event.activeLeafId]
          : null,
    ]),
  );
  const child = mapping.child
    ? definition.child(event, state.transcriptPath ?? transcriptPath)
    : null;
  const parent = process.env.AGENTCOMMONS_PARENT_SESSION_ID;
  const intent: Intent = {
    v: 1,
    id,
    sentAt:
      z.iso.datetime().safeParse(event.timestamp).data ??
      new Date().toISOString(),
    harness,
    sessionId: event.session_id,
    transcriptPath,
    behavior: mapping.behavior,
    nativeEvent: event.hook_event_name,
    resume: (event.source ?? event.reason) === "resume",
    reason: event.reason ?? null,
    context: {
      ...state.context,
      cwd: event.cwd,
      ...(event.activeLeafId !== undefined
        ? { activeLeafId: event.activeLeafId }
        : {}),
      ...(parent
        ? { parentHint: { harnessSessionId: parent, relation: "SPAWNED" } }
        : {}),
    },
    source,
    launch: identity,
    preceding,
    children: child
      ? [
          {
            ...child,
            source: snapshot(
              child.transcriptPath,
              { signature: null, size: 0, watermark: 0 },
              definition.reader,
            ),
          },
        ]
      : [],
  };
  publishIntent(path, intent);
  if (!liveOwner(ownerPath(path))) spawnUpload(config, executable, path);
  return path;
}
