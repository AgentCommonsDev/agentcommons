import { dirname, join } from "node:path";
import * as z from "zod";

export const nativeHookSchema = z.looseObject({
  session_id: z.string().min(1),
  transcript_path: z.string().min(1).optional(),
  cwd: z.string().min(1),
  hook_event_name: z.string().min(1),
  source: z.string().optional(),
  reason: z.string().optional(),
  agent_id: z.string().optional(),
  agent_type: z.string().optional(),
  agent_transcript_path: z.string().optional(),
  activeLeafId: z.string().nullable().optional(),
  prompt_id: z.string().optional(),
  turn_id: z.string().optional(),
  tool_use_id: z.string().optional(),
  timestamp: z.string().optional(),
  event_id: z.string().optional(),
  // Host facts a bridge observes that its transcript lacks (pi: version, entry point).
  transcript_metadata: z.record(z.string(), z.json()).optional(),
});
export type NativeHook = z.infer<typeof nativeHookSchema>;
export type CliHarness = "claude" | "codex" | "gemini" | "pi";
export type ReaderKind = "jsonl-append" | "json-document";
export interface ChildSource {
  sessionId: string;
  transcriptPath: string;
  agentType?: string;
}
export interface EventDefinition {
  behavior: "start" | "sync" | "end";
  always?: boolean;
  child?: boolean;
  childBehavior?: "start" | "end";
  parentPath?: boolean;
  /** The harness may append its final record after this hook fires; the uploader briefly waits for growth (§6.2). */
  settle?: boolean;
}
export interface HarnessDefinition {
  id: "CLAUDE_CODE" | "CODEX" | "GEMINI_CLI" | "PI";
  reader: ReaderKind;
  recordKeyFields: readonly string[];
  binary: string;
  processMarkers: readonly string[];
  configPath: readonly string[];
  /** Global instructions file that receives the §8.3 guidance block; null when the harness's extension carries it. */
  instructionsPath: readonly string[] | null;
  mcpConfigPath: readonly string[] | null;
  configFormat: "json" | "toml" | "extension";
  mcp(url: string): Record<string, unknown> | null;
  mcpCommand(url: string): string[] | null;
  /** Printed once after `install` wires this harness. */
  installNote?: string;
  /** Printed after `install` wires this harness and wrote the shell exports (§8.4). */
  shellExportNote?: string;
  timeout: number;
  events: Readonly<Record<string, EventDefinition>>;
  child(event: NativeHook, parentPath: string | null): ChildSource | null;
}
const shellEvents: Readonly<Record<string, EventDefinition>> = {
  SessionStart: { behavior: "start", always: true },
  UserPromptSubmit: { behavior: "sync", always: true },
  PostToolUse: { behavior: "sync" },
  Stop: { behavior: "sync", always: true, settle: true },
  SubagentStart: { behavior: "sync", child: true, childBehavior: "start" },
  SubagentStop: {
    behavior: "sync",
    always: true,
    child: true,
    childBehavior: "end",
    settle: true,
  },
  SessionEnd: { behavior: "end", always: true },
};
export const HARNESSES: Readonly<Record<CliHarness, HarnessDefinition>> = {
  claude: {
    id: "CLAUDE_CODE",
    mcpConfigPath: [".claude.json"],
    mcpCommand: (url) => [
      "mcp",
      "add",
      "-s",
      "user",
      "-t",
      "http",
      "agentcommons",
      url,
      "--header",
      "Authorization: Bearer ${AGENTCOMMONS_API_KEY}",
    ],
    reader: "jsonl-append",
    recordKeyFields: ["uuid"],
    binary: "claude",
    processMarkers: ["claude", "@anthropic-ai/claude-code"],
    // Claude Code 2.1.x defers every MCP tool behind ToolSearch unless the server is
    // marked always-loaded; the budgeted catalog (ADR 0053) makes eager loading cheap.
    // `claude mcp add` has no flag for it, so install merges the field after the CLI writes.
    mcp: (url) => ({
      type: "http",
      url,
      headers: { Authorization: "Bearer ${AGENTCOMMONS_API_KEY}" },
      alwaysLoad: true,
    }),
    configPath: [".claude", "settings.json"],
    instructionsPath: [".claude", "CLAUDE.md"],
    configFormat: "json",
    timeout: 3,
    events: shellEvents,
    child(event, parentPath) {
      if (!event.agent_id) return null;
      const transcriptPath =
        event.agent_transcript_path ??
        (parentPath
          ? join(
              dirname(parentPath),
              event.session_id,
              "subagents",
              `agent-${event.agent_id}.jsonl`,
            )
          : null);
      return transcriptPath
        ? {
            sessionId: `${event.session_id}:agent-${event.agent_id}`,
            transcriptPath,
            ...(event.agent_type ? { agentType: event.agent_type } : {}),
          }
        : null;
    },
  },
  codex: {
    id: "CODEX",
    mcpConfigPath: [".codex", "config.toml"],
    mcpCommand: (url) => [
      "mcp",
      "add",
      "agentcommons",
      "--url",
      url,
      "--bearer-token-env-var",
      "AGENTCOMMONS_API_KEY",
    ],
    reader: "jsonl-append",
    recordKeyFields: ["ordinal"],
    binary: "codex",
    processMarkers: ["codex", "@openai/codex"],
    mcp: (url) => ({ url, bearer_token_env_var: "AGENTCOMMONS_API_KEY" }),
    installNote:
      "Codex asks you to trust hooks on the next interactive launch.",
    shellExportNote:
      "Open a new terminal before starting Codex so it reads the exported key.",
    configPath: [".codex", "config.toml"],
    instructionsPath: [".codex", "AGENTS.md"],
    configFormat: "toml",
    timeout: 3,
    events: {
      ...shellEvents,
      SubagentStart: {
        behavior: "sync",
        child: true,
        parentPath: false,
        childBehavior: "start",
      },
    },
    child(event) {
      const transcriptPath =
        event.agent_transcript_path ??
        (event.hook_event_name === "SubagentStart"
          ? event.transcript_path
          : undefined);
      return event.agent_id && transcriptPath
        ? {
            sessionId: event.agent_id,
            transcriptPath,
            ...(event.agent_type ? { agentType: event.agent_type } : {}),
          }
        : null;
    },
  },
  gemini: {
    id: "GEMINI_CLI",
    mcpConfigPath: [".gemini", "settings.json"],
    mcpCommand: () => null,
    reader: "json-document",
    recordKeyFields: ["id"],
    binary: "gemini",
    processMarkers: ["gemini", "@google/gemini-cli"],
    mcp: (url) => ({
      httpUrl: url,
      headers: { Authorization: "Bearer ${AGENTCOMMONS_API_KEY}" },
    }),
    configPath: [".gemini", "settings.json"],
    instructionsPath: [".gemini", "GEMINI.md"],
    configFormat: "json",
    timeout: 3000,
    events: {
      SessionStart: { behavior: "start", always: true },
      BeforeAgent: { behavior: "sync", always: true },
      AfterTool: { behavior: "sync" },
      AfterAgent: { behavior: "sync", always: true, settle: true },
      SessionEnd: { behavior: "end", always: true },
    },
    child: () => null,
  },
  pi: {
    id: "PI",
    mcpConfigPath: null,
    mcpCommand: () => null,
    reader: "jsonl-append",
    recordKeyFields: ["id"],
    binary: "pi",
    processMarkers: ["pi", "@mariozechner/pi-coding-agent"],
    mcp: () => null,
    configPath: [".pi", "agent", "settings.json"],
    instructionsPath: null,
    configFormat: "extension",
    timeout: 3,
    events: {
      session_start: { behavior: "start", always: true },
      input: { behavior: "sync", always: true },
      tool_result: { behavior: "sync" },
      agent_end: { behavior: "sync", always: true, settle: true },
      session_tree: { behavior: "sync", always: true },
      session_shutdown: { behavior: "end", always: true },
    },
    child: () => null,
  },
};
export const cliHarnessSchema = z.enum(["claude", "codex", "gemini", "pi"]);
