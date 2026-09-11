/** One POSIX shell argument, single-quoted, so no interpolated value becomes code. */
export const shellQuote = (value: string) =>
  `'${value.replaceAll("'", "'\\''")}'`;
/** The served installer command with the key as one literal argument. */
export function formatInstallCommand(origin: string, key: string): string {
  return `curl -fsSL ${shellQuote(new URL("/install.sh", origin).href)} | sh -s -- --key ${shellQuote(key)}`;
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
/** Delimits one block AgentCommons owns inside a file the user owns. */
export interface BlockMarkers {
  begin: string;
  end: string;
}
/**
 * The one layout a marked block is written in, chosen so prettier's markdown printer
 * leaves it unchanged: a blank line after the begin marker (an HTML comment and a heading
 * are separate blocks), the content with no trailing whitespace, and the end marker on the
 * line after the last line of text, where the printer keeps it. The caller adds the final
 * newline and whatever separates the block from the text around it.
 */
export function markedBlock(markers: BlockMarkers, content: string): string {
  const body = content
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/^\n+|\n+$/g, "");
  return `${markers.begin}\n\n${body}\n${markers.end}`;
}
export function guidanceBlock(content: string): string {
  return markedBlock(guidanceMarkers, content);
}
/**
 * What a block says, without its layout: every line with trailing whitespace removed, blank
 * lines dropped. Two blocks with the same `blockText` carry the same guidance, so a
 * formatter that adds or removes blank lines (prettier puts one after a heading and after
 * the begin marker) never makes an existing block look out of date.
 */
export function blockText(content: string): string {
  return content
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line !== "")
    .join("\n");
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
  // A blank line after the heading: well-formed markdown that prettier leaves as it is.
  return `## AgentCommons\n\n${wrap(sentences.join(" "), 88)}`;
}
export const agentInstructions = agentInstructionsFor("machine");
export const repositoryInstructions = agentInstructionsFor("repository");
