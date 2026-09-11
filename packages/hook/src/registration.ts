import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { objectSchema } from "./config.js";
import { HARNESSES, type CliHarness } from "./harnesses.js";

/** The MCP server name the installer registers (§8.4). */
const MCP_NAME = "agentcommons";
/** A configuration file larger than this is not parsed on the hook path (§6.2 budget). */
const MAX_CONFIG_BYTES = 1024 * 1024;
/** The table that names MCP servers in each configuration format; pi has no MCP client. */
const MCP_KEYS: Readonly<
  Record<(typeof HARNESSES)[CliHarness]["configFormat"], string | null>
> = { json: "mcpServers", toml: "mcp_servers", extension: null };

/**
 * Whether the harness can act on a recall hint: `ok` when its MCP configuration carries a
 * usable `agentcommons` entry; `missing` when the file or the entry is absent;
 * `placeholder` when the entry still holds an unexpanded `${…}` (the client sends it
 * verbatim, the server answers 401 and the harness drops the server, Appendix A);
 * `unknown` when the file cannot be read within the hook budget, which hints as usual.
 */
type RegistrationStatus = "ok" | "missing" | "placeholder" | "unknown";
export function registrationStatus(
  harness: CliHarness,
  configHome: string,
): RegistrationStatus {
  const definition = HARNESSES[harness];
  const key = MCP_KEYS[definition.configFormat];
  if (!definition.mcpConfigPath || key === null) return "ok";
  const path = join(configHome, ...definition.mcpConfigPath);
  let text: string;
  try {
    if (statSync(path).size > MAX_CONFIG_BYTES) return "unknown";
    text = readFileSync(path, "utf8");
  } catch {
    return "missing";
  }
  // Codex's TOML reads the key from the environment by design (§8.4), so the placeholder
  // failure cannot occur there; a presence check keeps the TOML parser off the hook path
  // (install.ts loads it lazily, and hook mode must not pay its start-up).
  if (definition.configFormat === "toml")
    return text.includes(MCP_NAME) ? "ok" : "missing";
  try {
    const document = objectSchema.parse(JSON.parse(text) as unknown);
    const entry = objectSchema.parse(document[key] ?? {})[MCP_NAME];
    if (entry === undefined) return "missing";
    return JSON.stringify(entry).includes("${") ? "placeholder" : "ok";
  } catch {
    return "unknown";
  }
}
/** The file the status was read from, for the repair message. */
export function registrationFile(
  harness: CliHarness,
  configHome: string,
): string | null {
  const path = HARNESSES[harness].mcpConfigPath;
  return path ? join(configHome, ...path) : null;
}
