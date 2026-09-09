import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { agentInstructions } from "@agentcommons/core/format/install";
// Bundled with the extension by the shim's build (packages/hook/build.ts); zod-free.
import { dataDirectory, note } from "../../hook/src/paths.js";

interface ObservationState {
  events: WeakMap<object, { id: string; timestamp: string }>;
  lastTime: number;
  version?: string | null;
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
const HOST_PACKAGE = "@mariozechner/pi-coding-agent";
/**
 * pi's transcript records neither the host version nor its mode. The running host is
 * either the CLI (`<package>/dist/cli.js`) or an SDK script whose dependency tree holds
 * the package; read its package.json once and report nothing when neither is found.
 */
export function hostVersion(main: string | undefined): string | null {
  if (!main) return null;
  let script: string;
  try {
    script = realpathSync(main);
  } catch {
    return null;
  }
  const candidates = [join(dirname(script), "..", "package.json")];
  for (let directory = dirname(script); ; directory = dirname(directory)) {
    candidates.push(
      join(
        directory,
        "node_modules",
        ...HOST_PACKAGE.split("/"),
        "package.json",
      ),
    );
    if (dirname(directory) === directory) break;
  }
  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(candidate, "utf8"));
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "name" in parsed &&
        parsed.name === HOST_PACKAGE &&
        "version" in parsed &&
        typeof parsed.version === "string"
      )
        return parsed.version;
    } catch {
      /* Not this candidate. */
    }
  }
  return null;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** The shim's installed `config.json` (`install.sh`); absent or partial during upgrades. */
function configuration(): {
  directory: string;
  values: Record<string, unknown>;
} | null {
  const directory = dataDirectory();
  try {
    const input: unknown = JSON.parse(
      readFileSync(join(directory, "config.json"), "utf8"),
    );
    return isRecord(input) ? { directory, values: input } : null;
  } catch {
    return null;
  }
}
function observe(
  name: string,
  event: { type: string; reason?: string },
  context: ExtensionContext,
): void {
  try {
    const config = configuration();
    if (!config || typeof config.values.node !== "string") return;
    const { directory } = config;
    const node = config.values.node;
    let observation = observations.events.get(event);
    if (!observation) {
      observations.lastTime = Math.max(Date.now(), observations.lastTime + 1);
      observation = {
        id: randomUUID(),
        timestamp: new Date(observations.lastTime).toISOString(),
      };
      observations.events.set(event, observation);
    }
    if (observations.version === undefined)
      observations.version = hostVersion(process.argv[1]);
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
      // Host facts the transcript lacks; the shim forwards them as normalizer context.
      transcript_metadata: {
        ...(observations.version
          ? { harnessVersion: observations.version }
          : {}),
        entrypoint: context.hasUI ? "interactive" : "headless",
      },
    };
    const child = spawn(node, [join(directory, "hook.js"), "pi"], {
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
/**
 * Native tool bridge (ADR 0054). pi has no MCP client, so the extension registers the
 * key's permission-filtered MCP catalog as native tools named `agentcommons_<tool>`
 * and forwards each call to the instance's stateless `/mcp` endpoint with the
 * installation's key. Only `tools/list` and `tools/call` are spoken and the server
 * answers in JSON, so no session, stream or SDK client is needed. A missing,
 * unreachable or rejecting server registers nothing and leaves capture untouched.
 */
export const MCP_TOOL_PREFIX = "agentcommons_";
const CATALOG_TIMEOUT_MS = 3000;
const CALL_TIMEOUT_MS = 60_000;
const SNIPPET_LENGTH = 160;
interface Bridge {
  directory: string;
  server: string;
  key: string;
}
interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}
type Registration = Parameters<ExtensionAPI["registerTool"]>[0];
function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
async function rpc(
  bridge: Bridge,
  method: string,
  params: Record<string, unknown>,
  signal: AbortSignal,
): Promise<unknown> {
  const response = await fetch(new URL("/mcp", bridge.server), {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      authorization: `Bearer ${bridge.key}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal,
  });
  const body: unknown = await response.json().catch(() => null);
  if (isRecord(body) && isRecord(body.error))
    throw new Error(
      `${method}: ${typeof body.error.message === "string" ? body.error.message : "rejected"}`,
    );
  // Authentication and audit failures answer with the REST error envelope.
  if (!response.ok)
    throw new Error(
      `${method}: ${isRecord(body) && typeof body.message === "string" ? body.message : `HTTP ${String(response.status)}`}`,
    );
  if (!isRecord(body)) throw new Error(`${method}: no JSON-RPC response.`);
  return body.result;
}
function catalog(result: unknown): McpTool[] {
  if (!isRecord(result) || !Array.isArray(result.tools))
    throw new Error("tools/list returned no catalog.");
  return result.tools.flatMap((entry: unknown) =>
    isRecord(entry) &&
    typeof entry.name === "string" &&
    isRecord(entry.inputSchema)
      ? [
          {
            name: entry.name,
            description:
              typeof entry.description === "string" ? entry.description : "",
            inputSchema: entry.inputSchema,
          },
        ]
      : [],
  );
}
function toolOutcome(result: unknown): {
  text: string;
  isError: boolean;
  structured: unknown;
} {
  if (!isRecord(result)) throw new Error("tools/call returned no result.");
  const content = Array.isArray(result.content) ? result.content : [];
  return {
    text: content
      .flatMap((part: unknown) =>
        isRecord(part) && part.type === "text" && typeof part.text === "string"
          ? [part.text]
          : [],
      )
      .join("\n"),
    isError: result.isError === true,
    structured: result.structuredContent ?? null,
  };
}
function snippet(name: string, description: string): string {
  const line = description.replace(/\s+/g, " ").trim();
  return `${name}: ${line.length > SNIPPET_LENGTH ? `${line.slice(0, SNIPPET_LENGTH - 1).trimEnd()}…` : line}`;
}
async function registerTools(pi: ExtensionAPI, bridge: Bridge): Promise<void> {
  let tools: McpTool[];
  try {
    tools = catalog(
      await rpc(
        bridge,
        "tools/list",
        {},
        AbortSignal.timeout(CATALOG_TIMEOUT_MS),
      ),
    );
  } catch (error) {
    note(
      bridge.directory,
      `pi tool bridge registered no AgentCommons tools: ${reason(error)}`,
    );
    return;
  }
  for (const tool of tools) {
    const name = `${MCP_TOOL_PREFIX}${tool.name}`;
    const registration: Registration = {
      name,
      label: `AgentCommons ${tool.name}`,
      description: tool.description,
      promptSnippet: snippet(name, tool.description),
      // The server's JSON Schema is the shared zod schema; pi validates plain JSON
      // Schema without TypeBox metadata.
      parameters: tool.inputSchema,
      async execute(_toolCallId, params, signal) {
        const outcome = toolOutcome(
          await rpc(
            bridge,
            "tools/call",
            { name: tool.name, arguments: params },
            AbortSignal.any([
              AbortSignal.timeout(CALL_TIMEOUT_MS),
              ...(signal ? [signal] : []),
            ]),
          ),
        );
        if (outcome.isError)
          throw new Error(outcome.text || `${tool.name} failed.`);
        return {
          content: [{ type: "text", text: outcome.text }],
          details: outcome.structured,
        };
      },
    };
    try {
      pi.registerTool(registration);
    } catch (error) {
      // A host that replaced its session while the catalog was in flight rejects late
      // registrations; capture keeps working and the next session registers again.
      note(
        bridge.directory,
        `pi tool bridge stopped registering AgentCommons tools: ${reason(error)}`,
      );
      return;
    }
  }
}
export default async function agentcommons(pi: ExtensionAPI): Promise<void> {
  // pi has no global instructions file the installer could write; the same §8.3 guidance
  // joins the system prompt for every turn instead.
  pi.on("before_agent_start", (event) => ({
    systemPrompt: `${event.systemPrompt}\n\n${agentInstructions}`,
  }));
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
  const config = configuration();
  if (
    config &&
    typeof config.values.server === "string" &&
    typeof config.values.key === "string"
  )
    await registerTools(pi, {
      directory: config.directory,
      server: config.values.server,
      key: config.values.key,
    });
}
