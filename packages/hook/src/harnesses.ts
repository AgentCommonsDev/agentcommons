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
/**
 * A harness's pre-tool payload (ADR 0080): the fields the enforcement path reads to
 * evaluate a call. `tool_input` is a loose bag — its `command` is a string for a shell
 * tool and absent for an MCP call — so the command is extracted defensively, never assumed.
 * Claude Code, Codex and Gemini CLI all name the tool `tool_name` and carry the shell
 * command at `tool_input.command` (Appendix A, 2026-09-14), so one shape reads all three.
 */
export const preToolPayloadSchema = z.looseObject({
  session_id: z.string().min(1),
  cwd: z.string().min(1),
  hook_event_name: z.string().min(1),
  tool_name: z.string().min(1),
  tool_input: z.record(z.string(), z.unknown()).optional(),
});
export type PreToolPayload = z.infer<typeof preToolPayloadSchema>;
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
  /**
   * The harness adds this hook's stdout JSON (`hookSpecificOutput.additionalContext`) to
   * the model's context; the recall hint rides on it (§6.2): `start` for the session
   * overview once per session, `prompt` for the per-prompt hint.
   */
  hint?: "start" | "prompt";
  /**
   * A pre-tool enforcement event (ADR 0080, §6.4): evaluated against the cached policy
   * before the tool runs and never captured as a transcript record. `warn` renders this
   * harness's warn-channel stdout when the decision is `warn`; a `deny` uses one shape for
   * all shell harnesses (`{"decision":"block",…}`) and `allow` writes nothing.
   */
  preTool?: { warn(reason: string): string };
}
/**
 * Warn-channel stdout per harness (Appendix A pre-tool contracts, 2026-09-14). A `warn`
 * decision lets the tool run but surfaces the reason: Codex delivers it to the model as
 * `additionalContext`, Gemini to the user as `systemMessage`, Claude Code on both channels.
 */
const claudePreToolWarn = (reason: string): string =>
  JSON.stringify({
    systemMessage: reason,
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext: reason,
    },
  });
const codexPreToolWarn = (reason: string): string =>
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext: reason,
    },
  });
const geminiPreToolWarn = (reason: string): string =>
  JSON.stringify({ systemMessage: reason });
export interface HarnessDefinition {
  id: "CLAUDE_CODE" | "CODEX" | "GEMINI_CLI" | "PI";
  reader: ReaderKind;
  recordKeyFields: readonly string[];
  binary: string;
  processMarkers: readonly string[];
  configPath: readonly string[];
  /** Global instructions file that receives the §8.3 guidance block; null when the harness's extension carries it. */
  instructionsPath: readonly string[] | null;
  /** Instructions file this harness reads from a repository root; `hook.js guidance --repo` writes the §8.3 block there. */
  repositoryInstructionsFile: string;
  mcpConfigPath: readonly string[] | null;
  configFormat: "json" | "toml" | "extension";
  /**
   * The MCP entry the installer writes. `key` is written literally where the client's IDE
   * host cannot expand `${VAR}` (Claude Code's `~/.claude.json`, Gemini's `settings.json`,
   * which the Gemini Code Assist extension reads without a shell; both files are 0600).
   * Codex reads the key from the environment through its own `bearer_token_env_var`.
   */
  mcp(url: string, key: string): Record<string, unknown> | null;
  mcpCommand(url: string, key: string): string[] | null;
  /** Printed once after `install` wires this harness. */
  installNote?: string;
  /** Printed after `install` wires this harness and wrote the shell exports (§8.4). */
  shellExportNote?: string;
  timeout: number;
  events: Readonly<Record<string, EventDefinition>>;
  child(event: NativeHook, parentPath: string | null): ChildSource | null;
}
const shellEvents: Readonly<Record<string, EventDefinition>> = {
  // Claude Code delivers SessionStart additionalContext to the model (Appendix A,
  // 2026-09-11); Codex documents no such output and overrides this entry below.
  SessionStart: { behavior: "start", always: true, hint: "start" },
  UserPromptSubmit: { behavior: "sync", always: true, hint: "prompt" },
  // Claude Code uses `shellEvents` directly; Codex spreads it and overrides `PreToolUse`
  // below with its own warn channel. The installer wires this event from the same table.
  PreToolUse: { behavior: "sync", preTool: { warn: claudePreToolWarn } },
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
    mcpCommand: (url, key) => [
      "mcp",
      "add",
      "-s",
      "user",
      "-t",
      "http",
      "agentcommons",
      url,
      "--header",
      `Authorization: Bearer ${key}`,
    ],
    reader: "jsonl-append",
    recordKeyFields: ["uuid"],
    binary: "claude",
    processMarkers: ["claude", "@anthropic-ai/claude-code"],
    // Claude Code 2.1.x defers every MCP tool behind ToolSearch unless the server is
    // marked always-loaded; the budgeted catalog (ADR 0053) makes eager loading cheap.
    // `claude mcp add` has no flag for it, so install merges the field after the CLI writes.
    mcp: (url, key) => ({
      type: "http",
      url,
      headers: { Authorization: `Bearer ${key}` },
      alwaysLoad: true,
    }),
    configPath: [".claude", "settings.json"],
    instructionsPath: [".claude", "CLAUDE.md"],
    repositoryInstructionsFile: "CLAUDE.md",
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
      "Codex reads AGENTCOMMONS_API_KEY from the shell that starts it, so start it from a new terminal after installing. If its search tool reports the key is unset, run `echo $AGENTCOMMONS_API_KEY` in that shell; when it is empty, re-run the installer and open a new terminal.",
    configPath: [".codex", "config.toml"],
    instructionsPath: [".codex", "AGENTS.md"],
    repositoryInstructionsFile: "AGENTS.md",
    configFormat: "toml",
    timeout: 3,
    events: {
      ...shellEvents,
      SessionStart: { behavior: "start", always: true },
      PreToolUse: { behavior: "sync", preTool: { warn: codexPreToolWarn } },
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
    // Gemini Code Assist (VS Code) reads this file without a shell: an env placeholder
    // would be sent literally and rejected every few seconds (Appendix A, 2026-09-11).
    mcp: (url, key) => ({
      httpUrl: url,
      headers: { Authorization: `Bearer ${key}` },
    }),
    configPath: [".gemini", "settings.json"],
    instructionsPath: [".gemini", "GEMINI.md"],
    repositoryInstructionsFile: "GEMINI.md",
    configFormat: "json",
    timeout: 3000,
    events: {
      // Gemini CLI 0.35.3 documents SessionStart additionalContext (first turn in
      // history, or prepended to the prompt when non-interactive); canary-pending.
      SessionStart: { behavior: "start", always: true, hint: "start" },
      BeforeAgent: { behavior: "sync", always: true, hint: "prompt" },
      BeforeTool: { behavior: "sync", preTool: { warn: geminiPreToolWarn } },
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
    repositoryInstructionsFile: "AGENTS.md",
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
