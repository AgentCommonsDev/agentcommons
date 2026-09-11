import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  managementEntries,
  managementKeyVariable,
  managementServerName,
} from "@agentcommons/core/format/mcp-registration";
import { hash } from "../src/files.js";
import { HARNESSES, type CliHarness } from "../src/harnesses.js";
import { configure, install } from "../src/install.js";

const URL_ = "https://example.test/mcp";
const KEY = "ac_literal_test_key";
afterEach(() => {
  vi.unstubAllEnvs();
});
function home() {
  const directory = mkdtempSync(
    join(tmpdir(), "agentcommons-mcp-registration-"),
  );
  const bin = join(directory, "bin");
  mkdirSync(bin);
  for (const name of ["claude", "codex", "gemini"])
    writeFileSync(join(bin, name), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  vi.stubEnv("PATH", bin);
  const configHome = join(directory, "home");
  mkdirSync(configHome);
  const config = configure(directory, {
    server: "https://example.test",
    key: KEY,
    organizationId: "019939c0-0000-7000-8000-000000000001",
    credentialHash: hash(KEY),
  });
  return { directory, configHome, config };
}
const entry = (configHome: string, harness: CliHarness) => {
  const definition = HARNESSES[harness];
  if (!definition.mcpConfigPath) throw new Error("No MCP file.");
  const text = readFileSync(
    join(configHome, ...definition.mcpConfigPath),
    "utf8",
  );
  const servers = (JSON.parse(text) as { mcpServers?: Record<string, unknown> })
    .mcpServers;
  return { text, entry: servers?.agentcommons };
};

describe("MCP registration", () => {
  // @req R-INST-02
  it("writes the key literally for Claude Code and Gemini, keeps Codex on its env-var flag, and never a placeholder", () => {
    for (const name of Object.keys(HARNESSES) as CliHarness[]) {
      const definition = HARNESSES[name];
      const written = JSON.stringify(definition.mcp(URL_, KEY) ?? null);
      const command = JSON.stringify(definition.mcpCommand(URL_, KEY) ?? null);
      expect(written, name).not.toContain("${");
      expect(command, name).not.toContain("${");
    }
    expect(HARNESSES.claude.mcp(URL_, KEY)).toEqual({
      type: "http",
      url: URL_,
      headers: { Authorization: `Bearer ${KEY}` },
      alwaysLoad: true,
    });
    expect(HARNESSES.claude.mcpCommand(URL_, KEY)).toContain(
      `Authorization: Bearer ${KEY}`,
    );
    expect(HARNESSES.gemini.mcp(URL_, KEY)).toEqual({
      httpUrl: URL_,
      headers: { Authorization: `Bearer ${KEY}` },
    });
    expect(HARNESSES.codex.mcp(URL_, KEY)).toEqual({
      url: URL_,
      bearer_token_env_var: "AGENTCOMMONS_API_KEY",
    });
    expect(JSON.stringify(HARNESSES.codex.mcpCommand(URL_, KEY))).not.toContain(
      KEY,
    );
    expect(HARNESSES.pi.mcp(URL_, KEY)).toBeNull();
  });

  // @req R-DASH-43
  it("the management server entries the dashboard renders are the installer's shapes under another name, without alwaysLoad and on a second Codex variable", () => {
    const { alwaysLoad, ...claude } = HARNESSES.claude.mcp(URL_, KEY) ?? {};
    expect(alwaysLoad).toBe(true);
    expect(managementEntries.CLAUDE_CODE(URL_, KEY)).toEqual(claude);
    expect(managementEntries.GEMINI_CLI(URL_, KEY)).toEqual(
      HARNESSES.gemini.mcp(URL_, KEY),
    );
    expect(managementEntries.CODEX(URL_)).toEqual({
      ...HARNESSES.codex.mcp(URL_, KEY),
      bearer_token_env_var: managementKeyVariable,
    });
    expect(managementServerName).not.toBe("agentcommons");
    expect(managementKeyVariable).not.toBe("AGENTCOMMONS_API_KEY");
  });

  // @req R-INST-02 @req R-CAP-17
  it("install writes literal entries and a re-run heals a stale placeholder entry from an older bundle", () => {
    const { directory, configHome, config } = home();
    const options = { configHome, noShellRc: true };
    install(directory, config, options);
    const gemini = entry(configHome, "gemini");
    expect(gemini.entry).toEqual({
      httpUrl: URL_,
      headers: { Authorization: `Bearer ${KEY}` },
    });
    expect(gemini.text).not.toContain("${");
    expect(entry(configHome, "claude").entry).toMatchObject({
      headers: { Authorization: `Bearer ${KEY}` },
      alwaysLoad: true,
    });
    // As left by a bundle that wrote the env placeholder: the file and the installer's
    // registry both hold it. The reconcile run (§6.2) re-runs `install`, which rewrites it.
    const stale = {
      httpUrl: URL_,
      headers: { Authorization: "Bearer ${AGENTCOMMONS_API_KEY}" },
    };
    const settingsPath = join(configHome, ".gemini", "settings.json");
    const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as {
      mcpServers: Record<string, unknown>;
      other?: string;
    };
    settings.mcpServers.agentcommons = stale;
    settings.other = "user value";
    writeFileSync(settingsPath, JSON.stringify(settings));
    const registryPath = join(directory, "installations.json");
    const registry = JSON.parse(readFileSync(registryPath, "utf8")) as Record<
      string,
      { installed: unknown }
    >;
    const owned = registry[settingsPath];
    if (!owned) throw new Error("Missing registry entry.");
    owned.installed = stale;
    writeFileSync(registryPath, JSON.stringify(registry));
    install(directory, config, options);
    const healed = entry(configHome, "gemini");
    expect(healed.entry).toEqual({
      httpUrl: URL_,
      headers: { Authorization: `Bearer ${KEY}` },
    });
    expect(healed.text).not.toContain("${");
    expect(healed.text).toContain("user value");
    // Uninstall still recognizes the entry it owns and removes only that.
    install(directory, config, options, true);
    const removed = JSON.parse(readFileSync(settingsPath, "utf8")) as {
      mcpServers?: Record<string, unknown>;
      other?: string;
    };
    expect(removed.mcpServers?.agentcommons).toBeUndefined();
    expect(removed.other).toBe("user value");
  });
});
