import type { KeyPermissions } from "../schemas/common.js";
import { shellQuote } from "./install.js";

/**
 * The management server (ADR 0072, amendment): a second MCP registration, `agentcommons-admin`,
 * whose key carries `sessions:read`, `admin:*` and both tool groups, so an agent can manage
 * members, keys, redaction, moderation, dashboards and installations while the everyday
 * `agentcommons` server keeps `search`, `get` and `sql`. The dashboard's Management MCP page
 * (§10) renders these; the installer never writes them and never marks them always-loaded.
 */
export const managementServerName = "agentcommons-admin";
/** Codex reads its bearer token from the environment; a second variable keeps the standard key's. */
export const managementKeyVariable = "AGENTCOMMONS_ADMIN_API_KEY";
/** What a management key grants: reads, both tool groups and admin (§9.2); never ingest. */
export const managementPermissions = {
  sessions: ["read"],
  tools: ["dashboards", "administration"],
  admin: ["*"],
} as const satisfies KeyPermissions;
export type ManagementHarness = "CLAUDE_CODE" | "CODEX" | "GEMINI_CLI";
export interface ManagementRegistration {
  harness: ManagementHarness;
  /** The file the entry belongs in, as people know it. */
  file: string;
  language: "bash" | "toml" | "json";
  content: string;
  /** A shell line the entry depends on (Codex: the exported key), or null. */
  shell: string | null;
}
export const mcpServerUrl = (origin: string): string =>
  new URL("/mcp", origin).href;
/**
 * The entries each harness's MCP file holds for the management server. Claude Code and
 * Gemini carry the key literally (the IDE hosts expand no `${VAR}`, §8.4); Codex reads
 * `bearer_token_env_var` by design. The shapes are the installer's (`HARNESSES` in
 * `packages/hook`) under the management name, without `alwaysLoad`, which a hook test pins.
 */
export const managementEntries = {
  CLAUDE_CODE: (url: string, key: string) => ({
    type: "http",
    url,
    headers: { Authorization: `Bearer ${key}` },
  }),
  CODEX: (url: string) => ({
    url,
    bearer_token_env_var: managementKeyVariable,
  }),
  GEMINI_CLI: (url: string, key: string) => ({
    httpUrl: url,
    headers: { Authorization: `Bearer ${key}` },
  }),
} as const;
/** The management server registration for each MCP-capable harness, ready to paste. */
export function managementRegistrations(
  origin: string,
  key: string,
): ManagementRegistration[] {
  const url = mcpServerUrl(origin);
  const codex = managementEntries.CODEX(url);
  return [
    {
      harness: "CLAUDE_CODE",
      file: "~/.claude.json",
      language: "bash",
      content: [
        "claude mcp add -s user -t http",
        managementServerName,
        shellQuote(url),
        "--header",
        shellQuote(`Authorization: Bearer ${key}`),
      ].join(" "),
      shell: null,
    },
    {
      harness: "CODEX",
      file: "~/.codex/config.toml",
      language: "toml",
      content: [
        `[mcp_servers.${managementServerName}]`,
        `url = ${JSON.stringify(codex.url)}`,
        `bearer_token_env_var = ${JSON.stringify(codex.bearer_token_env_var)}`,
      ].join("\n"),
      shell: `export ${managementKeyVariable}=${shellQuote(key)}`,
    },
    {
      harness: "GEMINI_CLI",
      file: "~/.gemini/settings.json",
      language: "json",
      content: JSON.stringify(
        {
          mcpServers: {
            [managementServerName]: managementEntries.GEMINI_CLI(url, key),
          },
        },
        null,
        2,
      ),
      shell: null,
    },
  ];
}
