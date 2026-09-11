import { describe, expect, it } from "vitest";
import { keyPermissionsSchema } from "../schemas/common.js";
import {
  managementKeyVariable,
  managementPermissions,
  managementRegistrations,
  managementServerName,
} from "./mcp-registration.js";

describe("management server registration", () => {
  // @req R-DASH-43
  it("renders one pasteable entry per MCP harness under the management name, literal key for Claude Code and Gemini, env var for Codex, never always-loaded", () => {
    const key = "ac_management_'quoted'_key";
    const registrations = managementRegistrations(
      "https://example.test/base/",
      key,
    );
    expect(registrations.map((entry) => entry.harness)).toEqual([
      "CLAUDE_CODE",
      "CODEX",
      "GEMINI_CLI",
    ]);
    const [claude, codex, gemini] = registrations;
    if (!claude || !codex || !gemini) throw new Error("Three registrations.");
    expect(claude.content).toBe(
      `claude mcp add -s user -t http ${managementServerName} 'https://example.test/mcp' --header 'Authorization: Bearer ac_management_'\\''quoted'\\''_key'`,
    );
    expect(claude.shell).toBeNull();
    expect(codex.content).toBe(
      `[mcp_servers.${managementServerName}]\nurl = "https://example.test/mcp"\nbearer_token_env_var = "${managementKeyVariable}"`,
    );
    expect(codex.content).not.toContain(key);
    expect(codex.shell).toBe(
      `export ${managementKeyVariable}='ac_management_'\\''quoted'\\''_key'`,
    );
    expect(JSON.parse(gemini.content)).toEqual({
      mcpServers: {
        [managementServerName]: {
          httpUrl: "https://example.test/mcp",
          headers: { Authorization: `Bearer ${key}` },
        },
      },
    });
    for (const entry of registrations) {
      expect(entry.content).not.toContain("${");
      expect(entry.content).not.toContain("alwaysLoad");
    }
    expect(managementKeyVariable).not.toBe("AGENTCOMMONS_API_KEY");
    // Reads, both tool groups and admin, and the shared schema accepts the pair.
    expect(keyPermissionsSchema.parse(managementPermissions)).toEqual({
      sessions: ["read"],
      tools: ["dashboards", "administration"],
      admin: ["*"],
    });
  });
});
