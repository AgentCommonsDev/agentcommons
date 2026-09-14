import type { JsonValue } from "../schemas/common.js";

/**
 * The shell command a captured tool call carries, for policy evaluation, or null when it
 * carries none. Every supported harness's shell tool (Claude Code's `Bash`, Codex and
 * Gemini CLI's `run_shell_command`, pi's shell) puts the command in a `command` string on
 * the tool input, so one reader over the projected `tool_input` serves them all; a tool
 * with no such field (a file read, an MCP call) has no command, and a rule that carries
 * command patterns will not match it. Data, not a per-harness branch.
 */
export function commandFromToolInput(toolInput: JsonValue): string | null {
  if (
    typeof toolInput !== "object" ||
    toolInput === null ||
    Array.isArray(toolInput)
  )
    return null;
  const command = toolInput.command;
  return typeof command === "string" ? command : null;
}
