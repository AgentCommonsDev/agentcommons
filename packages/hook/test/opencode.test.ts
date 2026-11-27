import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    const config = configure(directory, {
      server: "https://example.test",
      key: KEY,
      organizationId: "019939c0-0000-7000-8000-000000000001",
      credentialHash: hash(KEY),
    });
    return { directory, home, config };
  }

  // @req R-HRN-07 @req R-HRN-09
  it("detects the desktop app's config folder, writes the plugin and the MCP entry, and removes them on uninstall", () => {
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
    const plugin = join(folder, "plugin", "agentcommons.js");
    expect(readFileSync(plugin, "utf8")).toBe(opencodePlugin);
    expect(opencodePlugin).toContain("agentcommons");
    const settings = JSON.parse(
      readFileSync(join(folder, "opencode.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(settings.model).toBe("kept");
    expect(settings.mcp).toEqual({
      agentcommons: {
        type: "remote",
        url: "https://example.test/mcp",
        headers: { Authorization: `Bearer ${KEY}` },
        oauth: false,
        enabled: true,
      },
    });
    // No global AGENTS.md: it would stop opencode from reading ~/.claude/CLAUDE.md.
    expect(existsSync(join(folder, "AGENTS.md"))).toBe(false);
    install(directory, config, { noShellRc: true }, true);
    expect(existsSync(plugin)).toBe(false);
    expect(
      (
        JSON.parse(readFileSync(join(folder, "opencode.json"), "utf8")) as {
          mcp: unknown;
        }
      ).mcp,
    ).toEqual({ agentcommons: previous });
  });
});
