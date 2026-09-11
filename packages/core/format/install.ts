/** Quote each value as one POSIX shell argument; no interpolated value becomes code. */
export function formatInstallCommand(origin: string, key: string): string {
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  return `curl -fsSL ${quote(new URL("/install.sh", origin).href)} | sh -s -- --key ${quote(key)}`;
}

/** Where a guidance block lives: a machine's global instructions file, or a repository's. */
export type GuidanceScope = "machine" | "repository";
/**
 * Delimits the one block AgentCommons owns inside an instructions file the user owns. The
 * installer, `hook.js guidance --repo` and the Install page snippet all use these markers,
 * so writing the block twice replaces it instead of repeating it.
 */
export const guidanceMarkers = {
  begin: "<!-- agentcommons-hook begin -->",
  end: "<!-- agentcommons-hook end -->",
} as const;
export function guidanceBlock(content: string): string {
  return `${guidanceMarkers.begin}\n${content}\n${guidanceMarkers.end}`;
}
/** Greedy word wrap; the instructions files are read by people as well as agents. */
function wrap(text: string, width: number): string {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines.join("\n");
}
const INDEXED: Record<GuidanceScope, string> = {
  machine:
    "Past agent sessions for this organization are indexed in AgentCommons (MCP server `agentcommons`: search, get, sql). This session is recorded automatically.",
  repository:
    "Past agent sessions on this repository and across its organization are indexed in AgentCommons (MCP server `agentcommons`: search, get, sql). Sessions on machines with the AgentCommons hook are recorded automatically.",
};
const SEARCH_FIRST =
  "Before you change code, search it for the test, file or error you were given: an earlier session often holds the root cause, the library the team chose or the exact value. Use it too when the user asks about prior work; anything beyond a quick lookup runs in a subagent that brings back only findings and session ids.";
const WITHOUT_SERVER =
  "If this machine has no `agentcommons` MCP server, tell the user once that the AgentCommons install is missing and continue without it.";
/**
 * The guidance in the two files an agent reads before its first edit. The machine text is
 * what the installer writes into each harness's global instructions file (`~/.claude/CLAUDE.md`,
 * `~/.codex/AGENTS.md`, `~/.gemini/GEMINI.md`) and the pi extension adds to pi's system
 * prompt; the repository text is the same guidance framed for a project's `AGENTS.md`
 * (`CLAUDE.md` and `GEMINI.md` as symlinks or copies), where a teammate's machine may not
 * have the install. The MCP server instructions and the `search` description carry the same
 * guidance (spec §8.2, §8.3, ADR 0057, ADR 0069).
 */
export function agentInstructionsFor(scope: GuidanceScope): string {
  const sentences = [
    INDEXED[scope],
    SEARCH_FIRST,
    ...(scope === "repository" ? [WITHOUT_SERVER] : []),
  ];
  return `## AgentCommons\n${wrap(sentences.join(" "), 88)}`;
}
export const agentInstructions = agentInstructionsFor("machine");
export const repositoryInstructions = agentInstructionsFor("repository");
