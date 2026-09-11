import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hash } from "../src/files.js";
import { HARNESSES } from "../src/harnesses.js";
import {
  configure,
  install,
  installFailed,
  installNotice,
} from "../src/install.js";

const URL_ = "https://example.test/mcp";
const KEY = "ac_literal_test_key";
afterEach(() => {
  vi.unstubAllEnvs();
});
/**
 * An isolated HOME (so the native registration path runs against it, never the real one)
 * and a PATH holding only a fake `claude` that exits with `claudeExit` and a fake `gemini`.
 */
function machine(claudeExit: number) {
  const directory = mkdtempSync(
    join(tmpdir(), "agentcommons-install-independence-"),
  );
  const bin = join(directory, "bin");
  mkdirSync(bin);
  writeFileSync(
    join(bin, "claude"),
    `#!/bin/sh\nexit ${String(claudeExit)}\n`,
    {
      mode: 0o700,
    },
  );
  writeFileSync(join(bin, "gemini"), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  const home = join(directory, "home");
  mkdirSync(home);
  vi.stubEnv("PATH", bin);
  vi.stubEnv("HOME", home);
  const config = configure(directory, {
    server: "https://example.test",
    key: KEY,
    organizationId: "019939c0-0000-7000-8000-000000000001",
    credentialHash: hash(KEY),
  });
  return { directory, home, config };
}
const servers = (path: string): Record<string, unknown> | undefined =>
  (
    JSON.parse(readFileSync(path, "utf8")) as {
      mcpServers?: Record<string, unknown>;
    }
  ).mcpServers;
const claudeEntry = (home: string) =>
  servers(join(home, ".claude.json"))?.agentcommons;
const geminiEntry = (home: string) =>
  servers(join(home, ".gemini", "settings.json"))?.agentcommons;

describe("installer independence", () => {
  // @req R-INST-02
  it("a failing `claude mcp add` is reported, Gemini's stale entry is still rewritten, and the run succeeds", () => {
    const { directory, home, config } = machine(1);
    // The placeholder an older bundle left in Gemini's file (Appendix A).
    mkdirSync(join(home, ".gemini"));
    writeFileSync(
      join(home, ".gemini", "settings.json"),
      JSON.stringify({
        theme: "kept",
        mcpServers: {
          agentcommons: {
            httpUrl: URL_,
            headers: { Authorization: "Bearer ${AGENTCOMMONS_API_KEY}" },
          },
        },
      }),
    );
    const result = install(directory, config, { noShellRc: true });
    expect(result.harnesses).toEqual(["claude", "gemini"]);
    expect(result.failures).toEqual([
      {
        harness: "claude",
        message: "The claude MCP registration failed.",
        native: true,
      },
    ]);
    expect(installFailed(result)).toBe(false);
    expect(installNotice(result.failures)).toBe(
      "claude: The claude MCP registration failed. The entry the installer wrote is in place.",
    );
    // Gemini healed despite Claude failing first; Claude's file carries the installer's entry.
    expect(geminiEntry(home)).toEqual(HARNESSES.gemini.mcp(URL_, KEY));
    expect(
      readFileSync(join(home, ".gemini", "settings.json"), "utf8"),
    ).toContain('"theme": "kept"');
    expect(claudeEntry(home)).toEqual(HARNESSES.claude.mcp(URL_, KEY));
    for (const path of [
      join(home, ".claude", "settings.json"),
      join(home, ".gemini", "settings.json"),
    ])
      expect(readFileSync(path, "utf8")).toContain("agentcommons-hook");
  });

  // @req R-INST-02
  it("a CLI that writes nowhere visible is a notice; a harness whose files cannot be written fails the run without stopping the others", () => {
    const { directory, home, config } = machine(0);
    // Gemini's settings path is a directory: nothing of Gemini's can be read or written.
    mkdirSync(join(home, ".gemini", "settings.json"), { recursive: true });
    const result = install(directory, config, { noShellRc: true });
    expect(
      result.failures.map((failure) => [failure.harness, failure.native]),
    ).toEqual([
      ["claude", true],
      ["gemini", false],
    ]);
    expect(result.failures[0]?.message).toBe(
      "The claude CLI wrote to an unexpected configuration location.",
    );
    expect(installFailed(result)).toBe(true);
    expect(installNotice(result.failures).split("\n")).toHaveLength(2);
    expect(claudeEntry(home)).toEqual(HARNESSES.claude.mcp(URL_, KEY));
    // A run in which every harness failed also fails, even when each failure was native.
    expect(
      installFailed({
        harnesses: ["claude"],
        failures: [{ harness: "claude", message: "x", native: true }],
      }),
    ).toBe(true);
    expect(
      installFailed({ harnesses: ["claude", "gemini"], failures: [] }),
    ).toBe(false);
  });
});
