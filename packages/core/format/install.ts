/** Quote each value as one POSIX shell argument; no interpolated value becomes code. */
export function formatInstallCommand(origin: string, key: string): string {
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  return `curl -fsSL ${quote(new URL("/install.sh", origin).href)} | sh -s -- --key ${quote(key)}`;
}

/**
 * The guidance block the installer writes into each harness's global instructions file
 * (`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, `~/.gemini/GEMINI.md`) and the pi
 * extension adds to pi's system prompt. The MCP server instructions and the `search`
 * description carry the same guidance (spec §8.2, §8.3, ADR 0057).
 */
export const agentInstructions = [
  "## AgentCommons",
  "Past agent sessions for this organization are indexed in AgentCommons (MCP server",
  "`agentcommons`: search, get, sql). This session is recorded automatically. Before you",
  "change code, search it for the test, file or error you were given: an earlier session",
  "often holds the root cause, the library the team chose or the exact value. Use it too",
  "when the user asks about prior work; anything beyond a quick lookup runs in a subagent",
  "that brings back only findings and session ids.",
].join("\n");
