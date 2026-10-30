import * as z from "zod";
import { spawn } from "node:child_process";
import type { ToolCall } from "../../core/schemas/tool-policy.js";
import { disabled, type HookConfig } from "./config.js";
import { hash } from "./files.js";
import {
  HARNESSES,
  nativeHookSchema,
  preToolPayloadSchema,
  type CliHarness,
} from "./harnesses.js";
import { liveOwner } from "./lock.js";
import { decide, readCachedPolicy, spoolDecision } from "./policy.js";
import { harnessIdentity } from "./process.js";
import { beforeEditHint } from "./recall.js";
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
/**
 * A hook that could not record its event (a state file this bundle cannot read, a fault
 * in this release) still starts the session's uploader when none is live. The uploader
 * runs the update check whatever its drain does (§6.2), so the release that fixes the
 * fault reaches the machine instead of every later hook failing the same way in silence.
 */
export function recoverUpload(
  directory: string,
  executable: string,
  config: HookConfig,
  harness: CliHarness,
  input: unknown,
): string | null {
  const event = z
    .looseObject({ session_id: z.string().min(1) })
    .safeParse(input);
  if (!event.success) return null;
  const path = statePath(directory, harness, event.data.session_id);
  if (liveOwner(ownerPath(path))) return null;
  spawnUpload(config, executable, path);
  return path;
}
/** Longest command spooled with a decision; the server accepts and scans the same bound. */
const MAX_SPOOL_COMMAND = 16_384;
/** The one deny shape every shell harness honours (Appendix A, 2026-09-14): exit 0. */
const denyStdout = (reason: string): string =>
  JSON.stringify({ decision: "block", reason });
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
/**
 * The pre-tool enforcement path (ADR 0080, §6.4). Returns true when the event is a
 * pre-tool event and this call owns the response — the caller then emits nothing further.
 * It is the hot path a shell harness blocks on before every tool call, so it stays local,
 * offline and fast: parse, read the cached policy, evaluate, write the decision. The shell
 * harnesses fail open on a slow or crashing hook, so any trouble after the event is
 * recognised returns true (allow, capture nothing) rather than throwing. `deny` writes the
 * one block shape all three honour; `warn` writes the harness's warn channel; `allow`
 * writes nothing. A blocked call fires no post-tool event, so the decision is spooled here
 * for the uploader to forward (never on the network on this path).
 */
export function enforcePreTool(
  directory: string,
  executable: string,
  config: HookConfig,
  harness: CliHarness,
  input: unknown,
): boolean {
  const eventName =
    isRecord(input) && typeof input.hook_event_name === "string"
      ? input.hook_event_name
      : null;
  if (!eventName) return false;
  const mapping = HARNESSES[harness].events[eventName];
  if (!mapping?.preTool) return false;
  try {
    const event = preToolPayloadSchema.parse(input);
    if (disabled(config, event.cwd)) return true;
    const raw = event.tool_input?.command;
    const command = typeof raw === "string" ? raw : null;
    const call: ToolCall = {
      harness: HARNESSES[harness].id,
      tool: event.tool_name,
      command,
    };
    const decision = decide(call, readCachedPolicy(directory));
    if (decision.decision === "allow") {
      // The tool runs. When a prior session already worked on the file about to be edited,
      // one concise recall line rides this harness's informational pre-tool `context` channel
      // (Claude/Codex `additionalContext`, Gemini `systemMessage`) — purely additive, no
      // decision field, so the allow outcome never changes and it never reads as a caution.
      // Reads the already-refreshed cache, never the network, and never throws (§6.2).
      const recall = beforeEditHint(directory, harness, event);
      if (recall) process.stdout.write(mapping.preTool.context(recall));
      return true;
    }
    const reason =
      decision.reason ?? "Blocked by the organization tool policy.";
    process.stdout.write(
      decision.decision === "deny"
        ? denyStdout(reason)
        : mapping.preTool.warn(reason),
    );
    // Telemetry is deny-only, after the decision is written: best effort, never awaited,
    // never blocking. A blocked call reaches no transcript, so the hook is its only source;
    // a warn runs and the server's projection records it from the transcript, so spooling a
    // warn here would double-count it.
    if (decision.decision === "deny") {
      spoolDecision(directory, {
        sessionId: event.session_id,
        harness: call.harness,
        tool: call.tool,
        command: command === null ? null : command.slice(0, MAX_SPOOL_COMMAND),
        ruleId: decision.matched_rule_id,
        decision: "deny",
        severity: decision.severity,
        matchedAt: new Date().toISOString(),
      });
      const path = statePath(directory, harness, event.session_id);
      if (!liveOwner(ownerPath(path))) spawnUpload(config, executable, path);
    }
    return true;
  } catch {
    // The event was a pre-tool event this bundle could not evaluate: fail open (allow) and
    // never fall through to capture it as a normal record.
    return true;
  }
}
export function recordHook(
  directory: string,
  executable: string,
  config: HookConfig,
  harness: CliHarness,
  input: unknown,
): string | null {
  const event = nativeHookSchema.parse(input);
  const definition = HARNESSES[harness];
  const mapping = definition.events[event.hook_event_name];
  if (!mapping || mapping.preTool || disabled(config, event.cwd)) return null;
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
  const identity = JSON.stringify(harnessIdentity(definition));
  const phase = latestPhase(state, waiting);
  const preceding =
    phase?.kind === mapping.behavior
      ? phase.preceding
      : (phase?.id ?? "initial");
  const nativeId = event.tool_use_id ?? event.prompt_id ?? event.turn_id ?? "";
  // A lifecycle event is its launch, its preceding phase and the transcript it observed:
  // duplicate callbacks of one event see the same file and coalesce, while a later start in
  // the same phase (Claude Code's SessionStart after each compaction) sees a grown one.
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
          : source.signature,
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
      ...(event.transcript_metadata
        ? { transcriptMetadata: event.transcript_metadata }
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
