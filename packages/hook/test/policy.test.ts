import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";

const child = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({
  spawn: child.spawn.mockReturnValue({
    on: () => undefined,
    unref: () => undefined,
  }),
}));

import { hash, jsonFiles, readJsonOr, writeAtomic } from "../src/files.js";
import { type CliHarness } from "../src/harnesses.js";
import { enforcePreTool, recordHook } from "../src/hook.js";
import { configure } from "../src/install.js";
import { policyCachePath, violationDir } from "../src/policy.js";
import {
  flushToolPolicyViolations,
  refreshToolPolicy,
} from "../src/policy-sync.js";
import { z } from "zod";

const ORG = "019939c0-0000-7000-8000-000000000001";
const SHIM = "/nonexistent-test-shim.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

/** A configured data directory the pre-tool hook reads its cache and config from. */
function setup() {
  const directory = mkdtempSync(join(tmpdir(), "agentcommons-policy-"));
  const config = configure(directory, {
    server: "http://127.0.0.1:3000",
    key: "test",
    organizationId: ORG,
    credentialHash: hash("test"),
  });
  return { directory, config };
}
function writePolicy(directory: string, policy: unknown): void {
  writeAtomic(policyCachePath(directory), {
    v: 1,
    fetchedAt: Date.now(),
    revision: 1,
    policy,
  });
}
const RULES = [
  {
    id: "deny-me",
    description: "Denied by test policy.",
    harnesses: [],
    tool: "*",
    command_patterns: [{ kind: "substring", value: "DENYME" }],
    action: "deny",
    severity: "critical",
  },
  {
    id: "warn-me",
    description: "Warned by test policy.",
    harnesses: [],
    tool: "*",
    command_patterns: [{ kind: "substring", value: "WARNME" }],
    action: "warn",
    severity: "medium",
  },
  {
    id: "deny-mcp",
    description: "Denied MCP by test policy.",
    harnesses: [],
    tool: "mcp__*",
    command_patterns: [],
    action: "deny",
    severity: "high",
  },
];
/** The pre-tool stdin each shell harness sends (Appendix A shapes: all use `tool_name` and
 * `tool_input.command`; only the event name differs). */
function payload(
  harness: CliHarness,
  command: string | null,
  tool?: string,
): Record<string, unknown> {
  const event = harness === "gemini" ? "BeforeTool" : "PreToolUse";
  const name = tool ?? (harness === "gemini" ? "run_shell_command" : "Bash");
  return {
    session_id: randomUUID(),
    cwd: "/tmp/repo",
    hook_event_name: event,
    tool_name: name,
    ...(command === null ? {} : { tool_input: { command } }),
    tool_use_id: "tool-1",
  };
}
/** Runs the enforcement path and returns the bytes it wrote to stdout and its verdict. */
function enforce(
  directory: string,
  config: ReturnType<typeof setup>["config"],
  harness: CliHarness,
  input: Record<string, unknown>,
): { handled: boolean; stdout: string } {
  const chunks: string[] = [];
  const spy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk: string | Uint8Array) => {
      chunks.push(
        typeof chunk === "string" ? chunk : Buffer.from(chunk).toString(),
      );
      return true;
    });
  let handled: boolean;
  try {
    handled = enforcePreTool(directory, SHIM, config, harness, input);
  } finally {
    spy.mockRestore();
  }
  return { handled, stdout: chunks.join("") };
}

// @req R-POL-09
it("denies, warns and allows with each shell harness's pre-tool output shape", () => {
  const { directory, config } = setup();
  writePolicy(directory, { enabled: true, rules: RULES });

  // Deny is the one block shape all three honour, exit 0 (no exit code set).
  for (const harness of ["claude", "codex", "gemini"] as const) {
    const deny = enforce(
      directory,
      config,
      harness,
      payload(harness, "echo DENYME"),
    );
    expect(deny.handled).toBe(true);
    expect(JSON.parse(deny.stdout)).toEqual({
      decision: "block",
      reason: "Denied by test policy.",
    });
  }

  // Warn differs per harness: Claude on both channels, Codex the model channel, Gemini the user's.
  expect(
    JSON.parse(
      enforce(directory, config, "claude", payload("claude", "echo WARNME"))
        .stdout,
    ),
  ).toEqual({
    systemMessage: "Warned by test policy.",
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext: "Warned by test policy.",
    },
  });
  expect(
    JSON.parse(
      enforce(directory, config, "codex", payload("codex", "echo WARNME"))
        .stdout,
    ),
  ).toEqual({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext: "Warned by test policy.",
    },
  });
  expect(
    JSON.parse(
      enforce(directory, config, "gemini", payload("gemini", "echo WARNME"))
        .stdout,
    ),
  ).toEqual({ systemMessage: "Warned by test policy." });

  // Allow writes nothing but still owns the event.
  const allow = enforce(
    directory,
    config,
    "claude",
    payload("claude", "echo hello"),
  );
  expect(allow.handled).toBe(true);
  expect(allow.stdout).toBe("");
});

// @req R-POL-09
it("matches MCP tool names (mcp__server__tool) with a null command and passes non-pre-tool events through", () => {
  const { directory, config } = setup();
  writePolicy(directory, { enabled: true, rules: RULES });
  const mcp = enforce(
    directory,
    config,
    "claude",
    payload("claude", null, "mcp__tpecho__echo"),
  );
  expect(JSON.parse(mcp.stdout)).toEqual({
    decision: "block",
    reason: "Denied MCP by test policy.",
  });
  // A non-pre-tool event is not ours: the caller falls through to capture it.
  const post = enforce(directory, config, "claude", {
    ...payload("claude", "echo DENYME"),
    hook_event_name: "PostToolUse",
  });
  expect(post.handled).toBe(false);
  expect(post.stdout).toBe("");
});

// @req R-POL-09
it("allows offline when the cache is missing or the policy is disabled, and is fast", () => {
  const { directory, config } = setup();
  // No cache written at all.
  const missing = enforce(
    directory,
    config,
    "claude",
    payload("claude", "echo DENYME"),
  );
  expect(missing.handled).toBe(true);
  expect(missing.stdout).toBe("");
  expect(child.spawn).not.toHaveBeenCalled(); // allow spawns no uploader

  writePolicy(directory, { enabled: false, rules: RULES });
  const disabled = enforce(
    directory,
    config,
    "claude",
    payload("claude", "echo DENYME"),
  );
  expect(disabled.stdout).toBe("");

  // Enabled: the decision is a local, few-millisecond read; never a network call.
  writePolicy(directory, { enabled: true, rules: RULES });
  const allowInput = payload("claude", "echo hello");
  const started = performance.now();
  for (let i = 0; i < 500; i++)
    enforcePreTool(directory, SHIM, config, "claude", allowInput);
  expect((performance.now() - started) / 500).toBeLessThan(5);
  expect(child.spawn).not.toHaveBeenCalled(); // still offline: no uploader kicked
});

// @req R-POL-11
it("spools a blocked decision with the raw command for the uploader and kicks it, but not on allow", () => {
  const { directory, config } = setup();
  writePolicy(directory, { enabled: true, rules: RULES });
  const input = payload("claude", "echo DENYME secret-token");
  enforce(directory, config, "claude", input);
  expect(child.spawn).toHaveBeenCalledTimes(1); // the detached uploader is kicked
  const files = jsonFiles(violationDir(directory));
  expect(files).toHaveLength(1);
  const file = files[0];
  if (!file) throw new Error("expected a spooled decision file");
  const record = JSON.parse(readFileSync(file, "utf8")) as Record<
    string,
    unknown
  >;
  expect(record).toMatchObject({
    v: 1,
    sessionId: input.session_id,
    harness: "CLAUDE_CODE",
    tool: "Bash",
    command: "echo DENYME secret-token",
    ruleId: "deny-me",
    decision: "deny",
    severity: "critical",
  });
  expect(typeof record.id).toBe("string");

  vi.clearAllMocks();
  enforce(directory, config, "claude", payload("claude", "echo fine"));
  expect(child.spawn).not.toHaveBeenCalled();
  expect(jsonFiles(violationDir(directory))).toHaveLength(1); // unchanged
});

// @req R-POL-09
it("never captures a pre-tool event as a transcript record", () => {
  const { directory, config } = setup();
  const transcript = join(directory, "t.jsonl");
  writeFileSync(transcript, '{"uuid":"one"}\n');
  const path = recordHook(directory, SHIM, config, "claude", {
    session_id: randomUUID(),
    transcript_path: transcript,
    cwd: directory,
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command: "echo DENYME" },
  });
  expect(path).toBeNull();
});

// @req R-POL-10
it("syncs the org policy into the cache the offline hook reads, throttled, keeping the last one on failure", async () => {
  const { directory, config } = setup();
  const body = {
    enabled: true,
    rules: RULES,
    revision: 7,
    updated_at: "2026-09-14T00:00:00.000Z",
  };
  let calls = 0;
  const ok: typeof fetch = () => {
    calls++;
    return Promise.resolve(Response.json(body));
  };
  expect(await refreshToolPolicy(directory, config, { fetch: ok })).toBe(
    "refreshed",
  );
  const cached = readJsonOr(
    policyCachePath(directory),
    z.looseObject({
      revision: z.number(),
      policy: z.looseObject({ enabled: z.boolean() }),
    }),
    null,
  );
  expect(cached?.revision).toBe(7);
  expect(cached?.policy.enabled).toBe(true);
  // Within the refresh interval it does not fetch again.
  expect(await refreshToolPolicy(directory, config, { fetch: ok })).toBe(
    "current",
  );
  expect(calls).toBe(1);

  // A failure much later keeps the last-known policy (only the timestamp advances).
  const fail: typeof fetch = () =>
    Promise.resolve(new Response(null, { status: 500 }));
  expect(
    await refreshToolPolicy(directory, config, {
      fetch: fail,
      now: () => Date.now() + 60 * 60_000,
    }),
  ).toBe("skipped");
  const kept = readJsonOr(
    policyCachePath(directory),
    z.looseObject({ policy: z.looseObject({ enabled: z.boolean() }) }),
    null,
  );
  expect(kept?.policy.enabled).toBe(true);
});

// @req R-POL-11
it("flushes spooled decisions to the violations endpoint and clears them only on 202", async () => {
  const { directory, config } = setup();
  writePolicy(directory, { enabled: true, rules: RULES });
  enforce(directory, config, "claude", payload("claude", "echo DENYME one"));
  enforce(directory, config, "codex", payload("codex", "echo WARNME two"));
  expect(jsonFiles(violationDir(directory))).toHaveLength(2);

  // A non-202 leaves the spool for the next run.
  const reject: typeof fetch = () =>
    Promise.resolve(new Response(null, { status: 503 }));
  expect(
    await flushToolPolicyViolations(directory, config, { fetch: reject }),
  ).toBe("skipped");
  expect(jsonFiles(violationDir(directory))).toHaveLength(2);

  // A 202 sends the wire shape (no `enforced`, raw command, client id) and clears them.
  let sent: unknown;
  const accept: typeof fetch = (url, options) => {
    expect(url instanceof URL ? url.pathname : "").toBe(
      "/api/v1/tool-policy/violations",
    );
    sent = JSON.parse(
      typeof options?.body === "string" ? options.body : "null",
    );
    return Promise.resolve(
      new Response(JSON.stringify({ accepted: 2 }), { status: 202 }),
    );
  };
  expect(
    await flushToolPolicyViolations(directory, config, { fetch: accept }),
  ).toBe("sent");
  expect(jsonFiles(violationDir(directory))).toHaveLength(0);
  const parsed = z
    .object({
      violations: z.array(
        z.object({
          id: z.string(),
          session_id: z.string(),
          harness: z.string(),
          tool: z.string(),
          command: z.string().nullable(),
          rule_id: z.string(),
          decision: z.enum(["deny", "warn"]),
          severity: z.string(),
          seq: z.null(),
          matched_at: z.string(),
        }),
      ),
    })
    .parse(sent);
  expect(parsed.violations).toHaveLength(2);
  expect(parsed.violations.map((v) => v.decision).sort()).toEqual([
    "deny",
    "warn",
  ]);
  expect(parsed.violations.some((v) => v.command === "echo DENYME one")).toBe(
    true,
  );
  // The wire shape carries no `enforced` field (the server sets it).
  expect(sent).not.toHaveProperty("violations.0.enforced");
});

// @req R-POL-12
it("wires the pre-tool hook for each shell harness from the HARNESSES table and removes it on uninstall", async () => {
  const { install } = await import("../src/install.js");
  const { directory, config } = setup();
  const configHome = join(directory, "home");
  const options = { configHome };
  // Detect claude/codex/gemini on a fake PATH so the installer selects them.
  const bin = join(directory, "bin");
  const { mkdirSync } = await import("node:fs");
  mkdirSync(bin, { recursive: true });
  for (const name of ["claude", "codex", "gemini", "pi"])
    writeFileSync(join(bin, name), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  vi.stubEnv("PATH", bin);

  install(directory, config, options, false);
  const claudeSettings = JSON.parse(
    readFileSync(join(configHome, ".claude", "settings.json"), "utf8"),
  ) as { hooks: Record<string, { hooks: { command: string }[] }[]> };
  const preHooks = claudeSettings.hooks.PreToolUse ?? [];
  const command = preHooks.flatMap((g) => g.hooks).map((h) => h.command);
  expect(
    command.some((c) => /agentcommons-hook/.test(c) && / claude /.test(c)),
  ).toBe(true);
  const gemini = JSON.parse(
    readFileSync(join(configHome, ".gemini", "settings.json"), "utf8"),
  ) as { hooks: Record<string, unknown[]> };
  expect(gemini.hooks.BeforeTool).toBeDefined();

  install(directory, config, options, true);
  const after = JSON.parse(
    readFileSync(join(configHome, ".claude", "settings.json"), "utf8"),
  ) as { hooks?: Record<string, { hooks: { command: string }[] }[]> };
  const remaining = (after.hooks?.PreToolUse ?? [])
    .flatMap((g) => g.hooks)
    .map((h) => h.command);
  expect(remaining.some((c) => /agentcommons-hook/.test(c))).toBe(false);
});
