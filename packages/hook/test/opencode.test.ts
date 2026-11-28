import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hash } from "../src/files.js";
import { recordHook } from "../src/hook.js";
import { configure, detectHarnesses, install } from "../src/install.js";
import { opencodePlugin } from "../src/opencode-plugin.js";
import { upload } from "../src/upload.js";
import { fixture } from "./fixture.js";

const capture = new URL(
  "../../../fixtures/transcripts/opencode/",
  import.meta.url,
);
const KEY = "ac_literal_test_key";
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("opencode capture", () => {
  // @req R-HRN-09 @req R-CAP-09
  it("uploads the session document and registers a subagent session under its parent", async () => {
    const parent = readFileSync(new URL("2.4.1-parent.json", capture), "utf8");
    const child = readFileSync(new URL("2.4.1-child.json", capture), "utf8");
    const f = fixture({
      harness: "opencode",
      transcriptName: "parent.json",
      initial: parent,
    });
    const childPath = join(f.directory, "child.json");
    writeFileSync(childPath, child);
    const path = f.hook({ hook_event_name: "session.start" });
    f.hook({
      hook_event_name: "subagent.start",
      agent_id: "child-session",
      agent_transcript_path: childPath,
      agent_type: "general",
    });
    f.hook({ hook_event_name: "idle" });
    await upload(f.directory, "/none", path, f.config, {
      fetch: f.fetcher,
      sweep: false,
    });
    const own = f.received.filter(
      (body) => body.harnessSessionId === f.event.session_id,
    );
    expect(own.every((body) => body.harness === "OPENCODE")).toBe(true);
    const messages = (JSON.parse(parent) as { messages: unknown[] }).messages;
    expect(own.flatMap((body) => body.records)).toHaveLength(messages.length);
    expect(
      own.find((body) => body.records.length)?.context.transcriptMetadata,
    ).toMatchObject({ harnessVersion: "2.4.1", title: "agentcommons-capture" });
    const children = f.received.filter(
      (body) => body.harnessSessionId === "child-session",
    );
    expect(children[0]?.behavior).toBe("start");
    expect(children.flatMap((body) => body.records).length).toBeGreaterThan(0);
    expect(children[0]?.context.parentHint).toMatchObject({
      harnessSessionId: f.event.session_id,
      relation: "SUBAGENT",
      agentType: "general",
    });
  });

  // @req R-HRN-09
  it("ignores an event the plugin does not send", () => {
    const f = fixture({
      harness: "opencode",
      transcriptName: "parent.json",
      initial: '{"messages":[]}',
    });
    expect(
      recordHook(f.directory, "/none", f.config, "opencode", {
        ...f.event,
        hook_event_name: "message.part.delta",
      }),
    ).toBeNull();
  });
});

describe("opencode install", () => {
  function machine() {
    const directory = mkdtempSync(join(tmpdir(), "agentcommons-opencode-"));
    const home = join(directory, "home");
    mkdirSync(home);
    // No opencode command on PATH, as with the desktop app alone.
    vi.stubEnv("PATH", join(directory, "empty-bin"));
    vi.stubEnv("HOME", home);
    vi.stubEnv("XDG_CONFIG_HOME", "");
    const config = configure(directory, {
      server: "https://example.test",
      key: KEY,
      organizationId: "019939c0-0000-7000-8000-000000000001",
      credentialHash: hash(KEY),
    });
    return { directory, home, config };
  }
  const mcpEntry = {
    type: "remote",
    url: "https://example.test/mcp",
    headers: { Authorization: `Bearer ${KEY}` },
    oauth: false,
    enabled: true,
  };

  // @req R-HRN-07 @req R-HRN-09
  it("detects the desktop app's config folder, writes the plugin bound to this installation and the MCP entry, and removes them and the session copies on uninstall", () => {
    const { directory, home, config } = machine();
    expect(detectHarnesses(home)).toEqual([]);
    const folder = join(home, ".config", "opencode");
    mkdirSync(folder, { recursive: true });
    const previous = { type: "remote", url: "https://old.example.test/mcp" };
    writeFileSync(
      join(folder, "opencode.json"),
      JSON.stringify({ model: "kept", mcp: { agentcommons: previous } }),
    );
    expect(detectHarnesses(home)).toEqual(["opencode"]);
    const result = install(directory, config, { noShellRc: true });
    expect(result).toEqual({ harnesses: ["opencode"], failures: [] });
    const plugin = readFileSync(
      join(folder, "plugin", "agentcommons.js"),
      "utf8",
    );
    expect(plugin).toBe(opencodePlugin(directory));
    // The desktop app's service has no AGENTCOMMONS_DIR, so the plugin names its installation.
    expect(plugin).toContain(JSON.stringify(directory));
    expect(plugin).not.toContain("__AGENTCOMMONS_INSTALL_DIRECTORY__");
    const settings = JSON.parse(
      readFileSync(join(folder, "opencode.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(settings.model).toBe("kept");
    expect(settings.mcp).toEqual({ agentcommons: mcpEntry });
    // No global AGENTS.md: it would stop opencode from reading ~/.claude/CLAUDE.md.
    expect(existsSync(join(folder, "AGENTS.md"))).toBe(false);
    mkdirSync(join(directory, "opencode"));
    writeFileSync(join(directory, "opencode", "ses_x.json"), "{}");
    install(directory, config, { noShellRc: true }, true);
    expect(existsSync(join(folder, "plugin", "agentcommons.js"))).toBe(false);
    expect(existsSync(join(directory, "opencode"))).toBe(false);
    expect(
      (
        JSON.parse(readFileSync(join(folder, "opencode.json"), "utf8")) as {
          mcp: unknown;
        }
      ).mcp,
    ).toEqual({ agentcommons: previous });
  });

  // @req R-HRN-09
  it("edits a commented opencode.json in place, keeping its comments, on install and uninstall", () => {
    const { directory, config, home } = machine();
    const folder = join(home, ".config", "opencode");
    mkdirSync(folder, { recursive: true });
    const path = join(folder, "opencode.json");
    writeFileSync(
      path,
      '{\n  // the team model\n  "model": "kept",\n  "autoupdate": false,\n}\n',
    );
    expect(install(directory, config, { noShellRc: true }).failures).toEqual(
      [],
    );
    const installed = readFileSync(path, "utf8");
    expect(installed).toContain("// the team model");
    expect(installed).toContain(`"Bearer ${KEY}"`);
    install(directory, config, { noShellRc: true }, true);
    const removed = readFileSync(path, "utf8");
    expect(removed).toContain("// the team model");
    expect(removed).not.toContain(KEY);
  });

  // @req R-HRN-09
  it("follows XDG_CONFIG_HOME, where opencode reads its configuration", () => {
    const { directory, config, home } = machine();
    const xdg = join(directory, "xdg");
    mkdirSync(join(xdg, "opencode"), { recursive: true });
    vi.stubEnv("XDG_CONFIG_HOME", xdg);
    expect(detectHarnesses(home)).toEqual(["opencode"]);
    install(directory, config, { noShellRc: true });
    expect(existsSync(join(xdg, "opencode", "plugin", "agentcommons.js"))).toBe(
      true,
    );
    expect(existsSync(join(home, ".config"))).toBe(false);
    // An explicit config home is an isolated root: XDG_CONFIG_HOME does not redirect it.
    const isolated = join(directory, "isolated");
    mkdirSync(join(isolated, ".config", "opencode"), { recursive: true });
    install(directory, config, { noShellRc: true, configHome: isolated });
    expect(
      existsSync(
        join(isolated, ".config", "opencode", "plugin", "agentcommons.js"),
      ),
    ).toBe(true);
  });

  // @req R-HRN-09
  it("imports from source without the build constant, and says so only when the plugin is needed", () => {
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        'const m = await import("./packages/hook/src/install.ts"); const p = await import("./packages/hook/src/opencode-plugin.ts"); try { p.opencodePlugin("/x"); } catch (e) { console.log(e.message); }',
      ],
      {
        cwd: fileURLToPath(new URL("../../../", import.meta.url)),
        encoding: "utf8",
      },
    );
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("carries no opencode plugin");
  });

  // @req R-HRN-09
  it("the built bundle installs opencode with its JSONC edits and the bound plugin", () => {
    const { directory, home } = machine();
    const folder = join(home, ".config", "opencode");
    mkdirSync(folder, { recursive: true });
    writeFileSync(
      join(folder, "opencode.json"),
      '{\n  // kept\n  "model": "m",\n}\n',
    );
    const bundle = fileURLToPath(new URL("../dist/hook.js", import.meta.url));
    const result = spawnSync(
      process.execPath,
      [bundle, "install", "--config-home", home, "--no-shell-rc"],
      {
        env: { ...process.env, AGENTCOMMONS_DIR: directory },
        encoding: "utf8",
      },
    );
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(readFileSync(join(folder, "opencode.json"), "utf8")).toContain(
      "// kept",
    );
    expect(
      readFileSync(join(folder, "plugin", "agentcommons.js"), "utf8"),
    ).toContain(JSON.stringify(directory));
  });
});
