import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";

interface ObservationState {
  events: WeakMap<object, { id: string; timestamp: string }>;
  lastTime: number;
}
const observationKey = Symbol.for("agentcommons.pi.observations.v1");
const shared = globalThis as typeof globalThis & {
  [key: symbol]: ObservationState | undefined;
};
const observations = shared[observationKey] ?? {
  events: new WeakMap<object, { id: string; timestamp: string }>(),
  lastTime: 0,
};
shared[observationKey] = observations;
function observe(
  name: string,
  event: { type: string; reason?: string },
  context: ExtensionContext,
): void {
  try {
    const directory =
      process.env.AGENTCOMMONS_DIR ?? join(homedir(), ".agentcommons");
    const input: unknown = JSON.parse(
      readFileSync(join(directory, "config.json"), "utf8"),
    );
    if (
      typeof input !== "object" ||
      input === null ||
      !("node" in input) ||
      typeof input.node !== "string"
    )
      return;
    let observation = observations.events.get(event);
    if (!observation) {
      observations.lastTime = Math.max(Date.now(), observations.lastTime + 1);
      observation = {
        id: randomUUID(),
        timestamp: new Date(observations.lastTime).toISOString(),
      };
      observations.events.set(event, observation);
    }
    const transcript = context.sessionManager.getSessionFile();
    const payload = {
      session_id: context.sessionManager.getSessionId(),
      event_id: observation.id,
      timestamp: observation.timestamp,
      ...(transcript ? { transcript_path: transcript } : {}),
      cwd: context.cwd,
      hook_event_name: name,
      activeLeafId: context.sessionManager.getLeafId(),
      ...(event.reason ? { reason: event.reason } : {}),
    };
    const child = spawn(input.node, [join(directory, "hook.js"), "pi"], {
      detached: true,
      stdio: ["pipe", "ignore", "ignore"],
    });
    child.on("error", () => {
      /* Collection must not interrupt the agent. */
    });
    child.stdin.on("error", () => {
      /* A stopped shim leaves the native transcript intact. */
    });
    child.stdin.end(JSON.stringify(payload));
    child.unref();
  } catch {
    /* Installation may be absent or being upgraded. */
  }
}
export default function agentcommons(pi: ExtensionAPI): void {
  pi.on("session_start", (event, context) => {
    observe("session_start", event, context);
  });
  pi.on("input", (event, context) => {
    observe("input", event, context);
  });
  pi.on("tool_result", (event, context) => {
    observe("tool_result", event, context);
  });
  pi.on("agent_end", (event, context) => {
    observe("agent_end", event, context);
  });
  pi.on("session_tree", (event, context) => {
    observe("session_tree", event, context);
  });
  pi.on("session_shutdown", (event, context) => {
    observe("session_shutdown", event, context);
  });
}
