import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { agentInstructions } from "@agentcommons/core/format/install";
import type { ToolCall } from "../../core/schemas/tool-policy.js";
// Bundled into the plugin by the shim's build (packages/hook/build.ts); zod-free.
import { dataDirectory } from "../../hook/src/paths.js";
import {
  decide,
  readCachedPolicy,
  spoolDecision,
} from "../../hook/src/policy.js";

/**
 * opencode bridge (SPEC §5.4, §6.1). opencode has no shell hooks and keeps sessions in a
 * SQLite database, so this plugin reads each session through opencode's own plugin API,
 * keeps it as one JSON document per session under `<data directory>/opencode/`, and starts
 * `hook.js opencode` on lifecycle events, as the pi extension does for pi.
 *
 * One file serves both plugin interfaces: opencode 1.x calls `server()`, opencode 2.x calls
 * `setup()`. 1.19.6 also runs an early 2.x loader that calls `setup()` with a context that
 * has no event, session or tool domain; `setup()` then does nothing, so a session is
 * recorded once.
 */

/**
 * The installer writes its own directory over this placeholder (hook `opencodePlugin`): the
 * desktop app's service starts without `AGENTCOMMONS_DIR`. Unreplaced, as in tests, the
 * shared default applies.
 */
const INSTALLATION = "__AGENTCOMMONS_INSTALL_DIRECTORY__";
export function installationDirectory(): string {
  return INSTALLATION.startsWith("__AGENTCOMMONS_")
    ? dataDirectory()
    : INSTALLATION;
}
/** A session's facts, the same for both generations; the document carries them at the top. */
export interface SessionFacts {
  id: string;
  parentId: string | null;
  title: string | null;
  directory: string | null;
  harnessVersion: string;
  startedAt: string | null;
  agent: string | null;
}
export interface SessionRead {
  session: SessionFacts;
  /** The engine's messages, in its own shape. */
  messages: unknown[];
}
/** What a lifecycle event means for capture; `start` is sent once per session and process. */
export type Lifecycle = "created" | "prompt" | "tool" | "idle" | "end";
type HookEvent =
  | "session.start"
  | "prompt"
  | "tool.after"
  | "idle"
  | "session.end"
  | "subagent.start"
  | "subagent.sync"
  | "subagent.end";
const topLevel: Readonly<Record<Lifecycle, HookEvent>> = {
  created: "idle",
  prompt: "prompt",
  tool: "tool.after",
  idle: "idle",
  end: "session.end",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
const text = (value: unknown): string | null =>
  typeof value === "string" && value ? value : null;
/** The shim's installed `config.json`; absent or partial during installs and upgrades. */
function nodePath(directory: string): string | null {
  try {
    const config: unknown = JSON.parse(
      readFileSync(join(directory, "config.json"), "utf8"),
    );
    return isRecord(config) ? text(config.node) : null;
  } catch {
    return null;
  }
}
/** A message's own id: 1.x keeps it in `info`, 2.x at the top. */
function messageId(value: unknown): string | null {
  if (!isRecord(value)) return null;
  return text(value.id) ?? (isRecord(value.info) ? text(value.info.id) : null);
}
/**
 * Folds a fresh read into the stored messages. A message keeps its first position and takes
 * its newest content; new messages are appended. Nothing is dropped, because opencode 2.x
 * returns only the messages after the last compaction.
 */
export function mergeMessages(
  stored: readonly unknown[],
  fresh: readonly unknown[],
): unknown[] {
  const merged = [...stored];
  const positions = new Map<string, number>();
  stored.forEach((value, index) => {
    const id = messageId(value);
    if (id) positions.set(id, index);
  });
  for (const value of fresh) {
    const id = messageId(value);
    const position = id === null ? undefined : positions.get(id);
    if (position === undefined) {
      if (id) positions.set(id, merged.length);
      merged.push(value);
    } else merged[position] = value;
  }
  return merged;
}
export function documentPath(directory: string, sessionId: string): string {
  return join(directory, "opencode", `${sessionId}.json`);
}
function storedMessages(path: string): unknown[] {
  try {
    const document: unknown = JSON.parse(readFileSync(path, "utf8"));
    return isRecord(document) && Array.isArray(document.messages)
      ? document.messages
      : [];
  } catch {
    return [];
  }
}
/** Writes the session document atomically; returns its path. */
export function writeDocument(directory: string, read: SessionRead): string {
  const path = documentPath(directory, read.session.id);
  mkdirSync(join(directory, "opencode"), { recursive: true, mode: 0o700 });
  const document = {
    sessionId: read.session.id,
    parentSessionId: read.session.parentId,
    title: read.session.title,
    directory: read.session.directory,
    harnessVersion: read.session.harnessVersion,
    startedAt: read.session.startedAt,
    agent: read.session.agent,
    messages: mergeMessages(storedMessages(path), read.messages),
  };
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(document), { mode: 0o600 });
  renameSync(temporary, path);
  return path;
}
/** Sessions without an event for this long are not ended at shutdown. */
const SHUTDOWN_END_WINDOW_MS = 30 * 60 * 1000;
/** How long a shutdown waits for `hook.js` to record an event; hook mode does no network. */
const SHUTDOWN_HOOK_TIMEOUT_MS = 3000;
/**
 * Runs `hook.js opencode` with one event on stdin. During a session it is started detached
 * and not waited for. At shutdown it is waited for: opencode 1.19.6 exits before a child
 * started in its last moments receives its input. Never throws.
 */
export function sendEvent(
  directory: string,
  payload: Record<string, unknown>,
  wait: boolean,
): void {
  const node = nodePath(directory);
  if (!node) return;
  const args = [join(directory, "hook.js"), "opencode"];
  // The shim finds its installation through this, as the shell harnesses' hook commands set it.
  const env = { ...process.env, AGENTCOMMONS_DIR: directory };
  try {
    if (wait) {
      spawnSync(node, args, {
        env,
        input: JSON.stringify(payload),
        stdio: ["pipe", "ignore", "ignore"],
        timeout: SHUTDOWN_HOOK_TIMEOUT_MS,
      });
      return;
    }
    const child = spawn(node, args, {
      env,
      detached: true,
      stdio: ["pipe", "ignore", "ignore"],
    });
    child.on("error", () => {
      /* Collection must not interrupt the agent. */
    });
    child.stdin.on("error", () => {
      /* A stopped shim leaves opencode's own store intact. */
    });
    child.stdin.end(JSON.stringify(payload));
    child.unref();
  } catch {
    /* Installation may be absent or being upgraded. */
  }
}

type Sessions = Map<string, { parent: string | null; active: number }>;
const sessionsKey = Symbol.for("agentcommons.opencode.sessions.v1");
/**
 * The sessions this process recorded, shared by every copy of the plugin it loads: opencode
 * 2.x reloads a plugin whose file changes (the installer rewrites it after a self-update),
 * and the new copy must carry on without restarting the sessions the old one recorded.
 */
function processSessions(): Sessions {
  const shared = globalThis as typeof globalThis & {
    [key: symbol]: Sessions | undefined;
  };
  return (shared[sessionsKey] ??= new Map() as Sessions);
}
const exitKey = Symbol.for("agentcommons.opencode.exit.v1");
/**
 * Ends the recorded sessions when the process exits, through the latest copy of the plugin.
 * Plugin cleanup cannot do it: opencode 2.x also runs it when it reloads the plugin.
 */
function endOnExit(recorder: Recorder): Recorder {
  const shared = globalThis as typeof globalThis & {
    [key: symbol]: { recorder: Recorder } | undefined;
  };
  const current = shared[exitKey];
  if (current) current.recorder = recorder;
  else {
    const registration = { recorder };
    shared[exitKey] = registration;
    process.once("exit", () => {
      registration.recorder.close();
    });
  }
  return recorder;
}
/**
 * Records the sessions one opencode process runs. Each session's events are handled in
 * order; a failed read or write drops that event, never the agent's work.
 */
export class Recorder {
  private readonly queues = new Map<string, Promise<void>>();
  constructor(
    private readonly read: (sessionId: string) => Promise<SessionRead | null>,
    private readonly directory: () => string = installationDirectory,
    private readonly deliver: typeof sendEvent = sendEvent,
    private readonly now: () => number = Date.now,
    /** Recorded sessions: their parent and when their last event was handled. */
    private readonly seen: Sessions = processSessions(),
  ) {}
  record(sessionId: string, lifecycle: Lifecycle): Promise<void> {
    const next = (this.queues.get(sessionId) ?? Promise.resolve())
      .then(() => this.handle(sessionId, lifecycle))
      .catch(() => {
        /* The next event retries with a fresh read. */
      });
    this.queues.set(sessionId, next);
    return next;
  }
  /** Waits for the events already queued, so their documents are written. */
  async flush(): Promise<void> {
    await Promise.all(this.queues.values());
  }
  /**
   * Ends the sessions active in the last half hour, for process shutdown. Synchronous, so it
   * also works from an exit handler; ending twice sends one end. A long-lived service has
   * seen many sessions; the older ones are left inactive rather than each delaying exit.
   */
  close(): void {
    const recent = this.now() - SHUTDOWN_END_WINDOW_MS;
    for (const [sessionId, { active }] of [...this.seen])
      if (active >= recent) this.end(sessionId, true);
    this.seen.clear();
  }
  /** Sends the end of a recorded session with the document as stored; the session may be gone. */
  private end(sessionId: string, shutdown = false): void {
    const directory = this.directory();
    if (
      !this.seen.has(sessionId) ||
      !existsSync(join(directory, "config.json"))
    )
      return;
    const parent = this.seen.get(sessionId)?.parent ?? null;
    this.seen.delete(sessionId);
    this.send(
      directory,
      sessionId,
      parent,
      documentPath(directory, sessionId),
      {
        first: false,
        lifecycle: "end",
        resume: false,
        agent: null,
        cwd: null,
        wait: shutdown,
      },
    );
  }
  private async handle(sessionId: string, lifecycle: Lifecycle): Promise<void> {
    const directory = this.directory();
    if (!existsSync(join(directory, "config.json"))) return;
    if (lifecycle === "end") {
      this.end(sessionId);
      return;
    }
    const read = await this.read(sessionId);
    if (!read) return;
    const first = !this.seen.has(sessionId);
    const resume = first && existsSync(documentPath(directory, sessionId));
    const path = writeDocument(directory, read);
    const parent = read.session.parentId;
    if (parent && !existsSync(documentPath(directory, parent))) {
      const parentRead = await this.read(parent);
      if (!parentRead) return;
      writeDocument(directory, parentRead);
    }
    this.seen.set(sessionId, { parent, active: this.now() });
    this.send(directory, sessionId, parent, path, {
      first,
      lifecycle,
      resume,
      agent: read.session.agent,
      cwd: read.session.directory,
      wait: false,
    });
  }
  /**
   * A child session reaches the shim as an event on its parent that names the child (the
   * `subagent.*` events), so the shim registers it under the parent with a SUBAGENT link.
   */
  private send(
    directory: string,
    sessionId: string,
    parent: string | null,
    path: string,
    event: {
      first: boolean;
      lifecycle: Lifecycle;
      resume: boolean;
      agent: string | null;
      cwd: string | null;
      wait: boolean;
    },
  ): void {
    const base = {
      event_id: randomUUID(),
      timestamp: new Date().toISOString(),
      cwd: event.cwd ?? storedDirectory(path) ?? process.cwd(),
    };
    if (parent) {
      this.deliver(
        directory,
        {
          ...base,
          session_id: parent,
          transcript_path: documentPath(directory, parent),
          hook_event_name: event.first
            ? "subagent.start"
            : event.lifecycle === "end"
              ? "subagent.end"
              : "subagent.sync",
          agent_id: sessionId,
          agent_transcript_path: path,
          ...(event.agent ? { agent_type: event.agent } : {}),
        },
        event.wait,
      );
      return;
    }
    this.deliver(
      directory,
      {
        ...base,
        session_id: sessionId,
        transcript_path: path,
        hook_event_name: event.first
          ? "session.start"
          : topLevel[event.lifecycle],
        ...(event.resume ? { source: "resume" } : {}),
      },
      event.wait,
    );
  }
}
function storedDirectory(path: string): string | null {
  try {
    const document: unknown = JSON.parse(readFileSync(path, "utf8"));
    return isRecord(document) ? text(document.directory) : null;
  } catch {
    return null;
  }
}

/** The longest command spooled with a decision; the server accepts and scans the same. */
const MAX_COMMAND = 16_384;
/**
 * Tool/command policy enforcement (ADR 0080, §6.4), as in the pi extension: evaluated
 * locally against the cached organization policy before a tool runs. A deny throws, which
 * opencode reports to the model as the tool's error and does not run the tool. No policy,
 * a disabled policy, an allow or a warn returns: opencode gives a plugin no channel to the
 * model or the user for a warning. Never throws for any other reason.
 */
export function enforceToolCall(
  tool: string,
  input: unknown,
  sessionId: string,
  directory: string = installationDirectory(),
): void {
  if (process.env.AGENTCOMMONS_DISABLE === "1") return;
  const policy = readCachedPolicy(directory);
  if (!policy) return;
  const command =
    isRecord(input) && typeof input.command === "string" ? input.command : null;
  const call: ToolCall = { harness: "OPENCODE", tool, command };
  const decision = decide(call, policy);
  if (decision.decision !== "deny") return;
  spoolDecision(directory, {
    sessionId,
    harness: "OPENCODE",
    tool,
    command: command === null ? null : command.slice(0, MAX_COMMAND),
    ruleId: decision.matched_rule_id,
    decision: "deny",
    severity: decision.severity,
    matchedAt: new Date().toISOString(),
  });
  throw new Error(
    decision.reason ?? "Blocked by the organization tool policy.",
  );
}

/** The parts of the opencode 1.x plugin input this plugin reads (`@opencode-ai/plugin`). */
export interface V1Input {
  client: {
    session: {
      get(options: { path: { id: string } }): Promise<{ data?: unknown }>;
      messages(options: { path: { id: string } }): Promise<{ data?: unknown }>;
    };
  };
}
interface V1Event {
  type: string;
  properties?: Record<string, unknown>;
}
export function readV1(input: V1Input) {
  return async (sessionId: string): Promise<SessionRead | null> => {
    const [info, messages] = await Promise.all([
      input.client.session.get({ path: { id: sessionId } }),
      input.client.session.messages({ path: { id: sessionId } }),
    ]);
    const session = info.data;
    if (!isRecord(session) || !Array.isArray(messages.data)) return null;
    const time = isRecord(session.time) ? session.time.created : null;
    return {
      session: {
        id: sessionId,
        parentId: text(session.parentID),
        title: text(session.title),
        directory: text(session.directory),
        harnessVersion: text(session.version) ?? "1",
        startedAt:
          typeof time === "number" ? new Date(time).toISOString() : null,
        agent: text(session.agent),
      },
      messages: messages.data,
    };
  };
}
function v1Session(event: V1Event): string | null {
  const properties = event.properties ?? {};
  return (
    text(properties.sessionID) ??
    (isRecord(properties.info) ? text(properties.info.id) : null)
  );
}
/** opencode 1.x: hooks returned from `server()`. */
export function v1Hooks(
  input: V1Input,
  recorder = new Recorder(readV1(input)),
) {
  return {
    // Recording is not awaited: opencode 1.x waits for its hooks before going on.
    event: ({ event }: { event: V1Event }): Promise<void> => {
      const sessionId = v1Session(event);
      if (!sessionId) return Promise.resolve();
      if (event.type === "session.created")
        void recorder.record(sessionId, "created");
      else if (event.type === "session.idle")
        void recorder.record(sessionId, "idle");
      else if (event.type === "session.deleted")
        void recorder.record(sessionId, "end");
      return Promise.resolve();
    },
    "chat.message": (data: { sessionID: string }): Promise<void> => {
      void recorder.record(data.sessionID, "prompt");
      return Promise.resolve();
    },
    "tool.execute.before": (
      data: { tool: string; sessionID: string },
      output: { args: unknown },
    ): Promise<void> => {
      enforceToolCall(data.tool, output.args, data.sessionID);
      return Promise.resolve();
    },
    "tool.execute.after": (data: { sessionID: string }): Promise<void> => {
      void recorder.record(data.sessionID, "tool");
      return Promise.resolve();
    },
    "experimental.chat.system.transform": (
      _data: unknown,
      output: { system: string[] },
    ): Promise<void> => {
      output.system.push(agentInstructions);
      return Promise.resolve();
    },
    // The process exit ends the sessions (`endOnExit`); this writes what is queued.
    dispose: (): Promise<void> => recorder.flush(),
  };
}

/** The parts of the opencode 2.x plugin context this plugin reads (`@opencode/plugin`). */
export interface V2Context {
  app: { version: string };
  event: {
    subscribe(options: {
      signal: AbortSignal;
    }): AsyncIterable<{ type: string; data?: unknown }>;
  };
  session: {
    get(input: { sessionID: string }): Promise<unknown>;
    context(input: { sessionID: string }): Promise<readonly unknown[]>;
    hook(
      name: "prompt" | "context",
      callback: (input: {
        sessionID: string;
        system: { type: "text"; text: string }[];
      }) => void,
    ): Promise<unknown>;
  };
  tool: {
    hook(
      name: "execute.before" | "execute.after",
      callback: (input: {
        tool: string;
        sessionID: string;
        input: unknown;
      }) => void,
    ): Promise<unknown>;
  };
}
export function readV2(context: V2Context) {
  return async (sessionId: string): Promise<SessionRead | null> => {
    const [session, messages] = await Promise.all([
      context.session.get({ sessionID: sessionId }),
      context.session.context({ sessionID: sessionId }),
    ]);
    if (!isRecord(session)) return null;
    const time = isRecord(session.time) ? session.time.created : null;
    return {
      session: {
        id: sessionId,
        parentId: text(session.parentID),
        title: text(session.title),
        directory: isRecord(session.location)
          ? text(session.location.directory)
          : null,
        harnessVersion: context.app.version,
        startedAt:
          typeof time === "number" ? new Date(time).toISOString() : null,
        agent: text(session.agent),
      },
      messages: [...messages],
    };
  };
}
const idleEvents = new Set([
  "session.execution.succeeded",
  "session.execution.failed",
  "session.execution.interrupted",
]);
/** A partial context, from 1.19.6's early 2.x loader, has none of these domains. */
export function isFullContext(context: unknown): context is V2Context {
  return (
    isRecord(context) &&
    isRecord(context.event) &&
    isRecord(context.session) &&
    isRecord(context.tool) &&
    isRecord(context.app)
  );
}
/** opencode 2.x: registrations made in `setup()`; returns the shutdown cleanup. */
export async function v2Setup(
  context: V2Context,
  recorder = new Recorder(readV2(context)),
): Promise<() => Promise<void>> {
  const stop = new AbortController();
  void (async () => {
    for await (const event of context.event.subscribe({
      signal: stop.signal,
    })) {
      const data = isRecord(event.data) ? event.data : {};
      const sessionId = text(data.sessionID);
      if (!sessionId) continue;
      if (event.type === "session.created")
        void recorder.record(sessionId, "created");
      else if (idleEvents.has(event.type))
        void recorder.record(sessionId, "idle");
      else if (event.type === "session.deleted")
        void recorder.record(sessionId, "end");
    }
  })().catch(() => {
    /* The event stream ended with the server. */
  });
  await context.session.hook("prompt", (input) => {
    void recorder.record(input.sessionID, "prompt");
  });
  await context.session.hook("context", (input) => {
    input.system.push({ type: "text", text: agentInstructions });
  });
  await context.tool.hook("execute.before", (input) => {
    enforceToolCall(input.tool, input.input, input.sessionID);
  });
  await context.tool.hook("execute.after", (input) => {
    void recorder.record(input.sessionID, "tool");
  });
  // Runs at shutdown and when opencode reloads the plugin; the process exit ends sessions.
  return async () => {
    stop.abort();
    await recorder.flush();
  };
}
export default {
  id: "agentcommons",
  async setup(context: unknown): Promise<(() => Promise<void>) | undefined> {
    if (!isFullContext(context)) return undefined;
    return v2Setup(context, endOnExit(new Recorder(readV2(context))));
  },
  server(input: V1Input) {
    return Promise.resolve(
      v1Hooks(input, endOnExit(new Recorder(readV1(input)))),
    );
  },
};
