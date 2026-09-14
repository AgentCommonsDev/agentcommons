import { spawn } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
  type Dirent,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";

/**
 * Dynamic tool/command policy acceptance test (ADR 0080, spec §6.5/§9.7). It proves the
 * enforcement path BLOCKS a disallowed command for real and ALLOWS it once the policy is
 * disabled, driving each supported harness the way the capture agent did
 * (capture-tool-policy-contracts.md) against the shipped `dist/hook.js` and
 * `dist/pi-extension.mjs` — never any of the user's real config.
 *
 * Two layers, both over the real built bundle:
 *  - Always (no credentials): the three shell harnesses feed their captured pre-tool
 *    payload through `dist/hook.js`, proving the exact veto the harness honours live —
 *    `{"decision":"block","reason":R}` at exit 0 when a deny rule matches, silence when the
 *    policy is disabled — plus the deny spool. pi is driven for real through its SDK
 *    session runtime with the shipped extension and a credential-free mock model, so the
 *    block is observable end to end (the `touch` never runs; the reason reaches the model).
 *  - Live (`TOOL_POLICY_LIVE=1`): the real Claude Code, Codex and Gemini CLIs are driven
 *    with an isolated config and a copied credential, attempting the sentinel command; the
 *    file must be absent and the deny reason surfaced with the policy enabled, and present
 *    once it is disabled. Opt-in because it needs live model credentials, like the live
 *    harness canary.
 *
 * @req R-POL-09 @req R-POL-02
 */

const REASON = "Blocked by the tool-policy dynamic acceptance test.";
/** A unique, safe, observable token; the sentinel command only creates a file named by it. */
const SENTINEL_TOKEN = "TPXBLOCK";
const RULE_ID = "deny-sentinel";
const root = resolve(__dirname, "..");
const hookBundle = resolve(root, "packages/hook/dist/hook.js");
const piExtension = resolve(root, "packages/hook/dist/pi-extension.mjs");
const piDriver = resolve(root, "e2e/tooling/tool-policy-pi-driver.mjs");
const geminiKeyFile = "/tmp/agentcommons-gemini-key";
const LIVE = process.env.TOOL_POLICY_LIVE === "1";

const scratch: string[] = [];
function workspace(prefix: string): string {
  const dir = mkdtempSync(
    join(tmpdir(), `agentcommons-tool-policy-${prefix}-`),
  );
  scratch.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of scratch.splice(0))
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  if (proof.length) {
    const out = resolve(root, "test-results/tool-policy-dynamic");
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "proof.md"), `${proof.join("\n")}\n`);
  }
});

/** Human-readable proof log lines, written to test-results/tool-policy-dynamic/proof.md. */
const proof: string[] = [
  "# Tool/command policy — dynamic acceptance proof",
  "",
  `Sentinel token: \`${SENTINEL_TOKEN}\` (deny rule \`${RULE_ID}\`); command: \`touch <tmp>/${SENTINEL_TOKEN}_FILE\`.`,
  "",
  "| harness | path | enabled → blocked (sentinel absent, reason shown) | disabled → allowed (sentinel present) |",
  "| --- | --- | --- | --- |",
];
function record(
  harness: string,
  path: string,
  blocked: string,
  allowed: string,
): void {
  proof.push(`| ${harness} | ${path} | ${blocked} | ${allowed} |`);
}

interface Ran {
  code: number | null;
  stdout: string;
  stderr: string;
}
function run(
  command: string,
  args: string[],
  options: {
    env?: NodeJS.ProcessEnv;
    input?: string;
    cwd?: string;
    timeoutMs?: number;
  } = {},
): Promise<Ran> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      env: options.env ?? process.env,
      cwd: options.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, options.timeoutMs ?? 60_000);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({ code, stdout, stderr });
    });
    child.stdin.on("error", () => {
      /* a failed CLI may close stdin first */
    });
    child.stdin.end(options.input ?? "");
  });
}

/** Writes the shim's on-disk config and the enabled/disabled policy cache into `dir`. */
function seed(dir: string, enabled: boolean): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(
    join(dir, "config.json"),
    JSON.stringify({
      server: "http://127.0.0.1:59999",
      key: "test-key",
      installationId: "019939c0-0000-7000-8000-0000000000aa",
      node: process.execPath,
      organizationId: "019939c0-0000-7000-8000-000000000001",
      credentialHash: "hash",
    }),
    { mode: 0o600 },
  );
  writeFileSync(
    join(dir, "tool-policy.json"),
    JSON.stringify({
      v: 1,
      fetchedAt: Date.now(),
      revision: 1,
      policy: {
        enabled,
        rules: [
          {
            id: RULE_ID,
            description: REASON,
            harnesses: [],
            tool: "*",
            command_patterns: [{ kind: "substring", value: SENTINEL_TOKEN }],
            action: "deny",
            severity: "high",
          },
        ],
      },
    }),
    { mode: 0o600 },
  );
}

// --- Built-bundle path: the three shell harnesses over the real dist/hook.js ------------

const blockSchema = z.strictObject({
  decision: z.literal("block"),
  reason: z.string(),
});
const spoolSchema = z.looseObject({
  tool: z.string(),
  command: z.string().nullable(),
  rule_id: z.string().optional(),
  ruleId: z.string().optional(),
  decision: z.literal("deny"),
  severity: z.string(),
});

interface ShellBundleCase {
  cli: "claude" | "codex" | "gemini";
  mode: string;
  event: string;
  tool: string;
  toolUseId?: string;
}
const shellBundleCases: ShellBundleCase[] = [
  {
    cli: "claude",
    mode: "claude",
    event: "PreToolUse",
    tool: "Bash",
    toolUseId: "toolu_dyn",
  },
  {
    cli: "codex",
    mode: "codex",
    event: "PreToolUse",
    tool: "Bash",
    toolUseId: "exec-dyn",
  },
  {
    cli: "gemini",
    mode: "gemini",
    event: "BeforeTool",
    tool: "run_shell_command",
  },
];
function preToolPayload(
  test: ShellBundleCase,
  dir: string,
  command: string,
): string {
  return JSON.stringify({
    session_id: randomUUID(),
    cwd: dir,
    hook_event_name: test.event,
    tool_name: test.tool,
    tool_input: { command },
    ...(test.toolUseId ? { tool_use_id: test.toolUseId } : {}),
  });
}

describe("built shim bundle enforces the pre-tool veto contract", () => {
  it("has a built hook bundle to exercise", () => {
    expect(existsSync(hookBundle)).toBe(true);
  });

  for (const test of shellBundleCases) {
    // @req R-POL-09 @req R-POL-02
    it(`${test.cli}: dist/hook.js blocks a denied command and allows it when disabled`, async () => {
      const sentinel = `touch ${join(workspace(`${test.cli}-bundle`), `${SENTINEL_TOKEN}_FILE`)}`;

      const enabledDir = workspace(`${test.cli}-on`);
      seed(enabledDir, true);
      const denied = await run(process.execPath, [hookBundle, test.mode], {
        env: { ...process.env, AGENTCOMMONS_DIR: enabledDir },
        input: preToolPayload(test, enabledDir, sentinel),
      });
      expect(denied.code).toBe(0);
      expect(blockSchema.parse(JSON.parse(denied.stdout))).toEqual({
        decision: "block",
        reason: REASON,
      });
      // The deny is spooled for the uploader; a blocked call fires no post-tool event.
      const spoolDir = join(enabledDir, "tool-policy", "violations");
      const spooled = readdirSync(spoolDir).filter((name) =>
        name.endsWith(".json"),
      );
      expect(spooled.length).toBeGreaterThanOrEqual(1);
      const parsedSpool = spoolSchema.parse(
        JSON.parse(readFileSync(join(spoolDir, spooled[0]), "utf8")),
      );
      expect(parsedSpool.command).toBe(sentinel);
      expect(parsedSpool.ruleId ?? parsedSpool.rule_id).toBe(RULE_ID);

      const disabledDir = workspace(`${test.cli}-off`);
      seed(disabledDir, false);
      const allowed = await run(process.execPath, [hookBundle, test.mode], {
        env: { ...process.env, AGENTCOMMONS_DIR: disabledDir },
        input: preToolPayload(test, disabledDir, sentinel),
      });
      expect(allowed.code).toBe(0);
      // Allow writes nothing; the harness then runs the command normally.
      expect(allowed.stdout).toBe("");
      expect(existsSync(join(disabledDir, "tool-policy", "violations"))).toBe(
        false,
      );
      record(
        test.cli,
        "built dist/hook.js",
        "block bytes emitted + deny spooled",
        "silent allow",
      );
    });
  }
});

// --- pi: the real SDK session runtime with the shipped extension and a mock model -------

const piResultSchema = z.strictObject({
  enabled: z.boolean(),
  sentinelPresent: z.boolean(),
  reasonSurfaced: z.boolean(),
  error: z.string().nullable(),
});
async function drivePi(
  enabled: boolean,
): Promise<z.infer<typeof piResultSchema>> {
  const result = await run(
    process.execPath,
    [piDriver, enabled ? "enabled" : "disabled"],
    { timeoutMs: 90_000 },
  );
  const line = result.stdout.trim().split("\n").at(-1) ?? "";
  return piResultSchema.parse(JSON.parse(line));
}

describe("real pi session enforces the policy through its extension", () => {
  it("has a built pi extension to register", () => {
    expect(existsSync(piExtension)).toBe(true);
  });

  // @req R-POL-09 @req R-POL-02
  it("pi: a denied bash call is blocked (file absent, reason to the model) and runs once disabled", async () => {
    const blocked = await drivePi(true);
    expect(blocked.error).toBeNull();
    expect(blocked.sentinelPresent).toBe(false);
    expect(blocked.reasonSurfaced).toBe(true);

    const allowed = await drivePi(false);
    expect(allowed.error).toBeNull();
    expect(allowed.sentinelPresent).toBe(true);
    record(
      "pi",
      "real pi SDK + shipped extension (mock model)",
      "tool_call blocked, file absent, reason to model",
      "tool_call ran, file created",
    );
  }, 120_000);
});

// --- Live real CLIs: Claude Code, Codex, Gemini (TOOL_POLICY_LIVE=1) ---------------------

interface LiveOutcome {
  sentinelPresent: boolean;
  reasonSurfaced: boolean;
  denySpooled: number;
  credentialUntouched: boolean;
}
/** The deny reason reaches the agent verbatim: in the CLI output (Codex, Gemini) or the
 * session transcript (Claude writes it as the tool_result). Scans both, deterministically. */
function reasonReachedAgent(output: string, transcriptRoot: string): boolean {
  if (output.includes(REASON)) return true;
  const stack = [transcriptRoot];
  while (stack.length) {
    const current = stack.pop();
    if (current === undefined) break;
    let entries: Dirent[];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      try {
        if (statSync(full).size > 8_000_000) continue;
        if (readFileSync(full, "utf8").includes(REASON)) return true;
      } catch {
        /* skip unreadable files */
      }
    }
  }
  return false;
}
/** How many deny decisions the pre-tool gate spooled for the uploader in this data dir. */
function denyCount(data: string): number {
  try {
    return readdirSync(join(data, "tool-policy", "violations")).filter((name) =>
      name.endsWith(".json"),
    ).length;
  } catch {
    return 0;
  }
}
/** Copies one credential file into an isolated home, asserting the original is never touched. */
function borrowCredential(
  source: string,
  destination: string,
): { restore: () => void; untouched: () => boolean } {
  const before = statSync(source).mtimeMs;
  copyFileSync(source, destination);
  chmodSync(destination, 0o600);
  return {
    restore: () => {
      try {
        rmSync(destination, { force: true });
      } catch {
        /* best effort */
      }
    },
    untouched: () => statSync(source).mtimeMs === before,
  };
}

async function driveClaude(
  dir: string,
  enabled: boolean,
): Promise<LiveOutcome> {
  const cfg = join(dir, enabled ? "on-config" : "off-config");
  const data = join(dir, enabled ? "on-data" : "off-data");
  const sentinel = join(dir, enabled ? "on" : "off", `${SENTINEL_TOKEN}_FILE`);
  mkdirSync(cfg, { recursive: true, mode: 0o700 });
  mkdirSync(join(dir, enabled ? "on" : "off"), { recursive: true });
  seed(data, enabled);
  const credential = borrowCredential(
    join(homedir(), ".claude/.credentials.json"),
    join(cfg, ".credentials.json"),
  );
  writeFileSync(
    join(cfg, ".claude.json"),
    JSON.stringify({
      hasCompletedOnboarding: true,
      bypassPermissionsModeAccepted: true,
    }),
    { mode: 0o600 },
  );
  writeFileSync(
    join(cfg, "settings.json"),
    JSON.stringify({
      hooks: {
        PreToolUse: [
          {
            matcher: "",
            hooks: [
              {
                type: "command",
                command: `AGENTCOMMONS_DIR=${data} ${process.execPath} ${hookBundle} claude ac-tool-policy-dynamic`,
                timeout: 30,
              },
            ],
          },
        ],
      },
    }),
    { mode: 0o600 },
  );
  const result = await run(
    "claude",
    [
      "--print",
      "--permission-mode",
      "bypassPermissions",
      "--allowedTools",
      "Bash",
      "--",
      `Run this exact shell command with the Bash tool and nothing else: touch ${sentinel}`,
    ],
    {
      env: {
        ...process.env,
        CLAUDE_CONFIG_DIR: cfg,
        AGENTCOMMONS_DIR: data,
      },
      cwd: dir,
      timeoutMs: 120_000,
    },
  );
  const untouched = credential.untouched();
  credential.restore();
  return {
    sentinelPresent: existsSync(sentinel),
    reasonSurfaced: reasonReachedAgent(`${result.stdout}${result.stderr}`, cfg),
    denySpooled: denyCount(data),
    credentialUntouched: untouched,
  };
}

async function driveCodex(dir: string, enabled: boolean): Promise<LiveOutcome> {
  const home = join(dir, enabled ? "on-codex" : "off-codex");
  const data = join(dir, enabled ? "on-data" : "off-data");
  const repo = join(dir, enabled ? "on-repo" : "off-repo");
  const sentinel = join(dir, enabled ? "on" : "off", `${SENTINEL_TOKEN}_FILE`);
  mkdirSync(home, { recursive: true, mode: 0o700 });
  mkdirSync(repo, { recursive: true });
  mkdirSync(join(dir, enabled ? "on" : "off"), { recursive: true });
  seed(data, enabled);
  await run("git", ["init", "-q"], { cwd: repo });
  await run("git", ["config", "user.email", "t@example.com"], { cwd: repo });
  await run("git", ["config", "user.name", "t"], { cwd: repo });
  await run("git", ["commit", "-q", "--allow-empty", "-m", "init"], {
    cwd: repo,
  });
  const credential = borrowCredential(
    join(homedir(), ".codex/auth.json"),
    join(home, "auth.json"),
  );
  writeFileSync(
    join(home, "config.toml"),
    [
      'model = "gpt-6-astra"',
      "",
      "[[hooks.PreToolUse]]",
      'matcher = ""',
      "[[hooks.PreToolUse.hooks]]",
      'type = "command"',
      `command = "AGENTCOMMONS_DIR=${data} ${process.execPath} ${hookBundle} codex ac-tool-policy-dynamic"`,
      "timeout = 30",
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
  const result = await run(
    "codex",
    [
      "exec",
      "--dangerously-bypass-hook-trust",
      "--skip-git-repo-check",
      "--sandbox",
      "workspace-write",
      "-C",
      repo,
      `Run this exact shell command and nothing else: touch ${sentinel}`,
    ],
    {
      env: { ...process.env, CODEX_HOME: home, AGENTCOMMONS_DIR: data },
      cwd: repo,
      timeoutMs: 120_000,
    },
  );
  const untouched = credential.untouched();
  credential.restore();
  return {
    sentinelPresent: existsSync(sentinel),
    reasonSurfaced: reasonReachedAgent(
      `${result.stdout}${result.stderr}`,
      home,
    ),
    denySpooled: denyCount(data),
    credentialUntouched: untouched,
  };
}

async function driveGemini(
  dir: string,
  enabled: boolean,
): Promise<LiveOutcome> {
  const home = join(dir, enabled ? "on-home" : "off-home");
  const data = join(dir, enabled ? "on-data" : "off-data");
  const repo = join(dir, enabled ? "on-repo" : "off-repo");
  const sentinel = join(dir, enabled ? "on" : "off", `${SENTINEL_TOKEN}_FILE`);
  mkdirSync(join(home, ".gemini"), { recursive: true, mode: 0o700 });
  mkdirSync(repo, { recursive: true });
  mkdirSync(join(dir, enabled ? "on" : "off"), { recursive: true });
  seed(data, enabled);
  writeFileSync(
    join(home, ".gemini/settings.json"),
    JSON.stringify({
      hooks: {
        BeforeTool: [
          {
            matcher: "",
            hooks: [
              {
                type: "command",
                command: `AGENTCOMMONS_DIR=${data} ${process.execPath} ${hookBundle} gemini ac-tool-policy-dynamic`,
                timeout: 30000,
              },
            ],
          },
        ],
      },
    }),
    { mode: 0o600 },
  );
  const key = readFileSync(geminiKeyFile, "utf8").trim();
  const result = await run(
    "gemini",
    [
      "--prompt",
      `Run this exact shell command and nothing else with run_shell_command: touch ${sentinel}`,
      "--approval-mode",
      "yolo",
    ],
    {
      env: {
        ...process.env,
        HOME: home,
        GEMINI_API_KEY: key,
        AGENTCOMMONS_DIR: data,
      },
      cwd: repo,
      timeoutMs: 120_000,
    },
  );
  return {
    sentinelPresent: existsSync(sentinel),
    reasonSurfaced: reasonReachedAgent(
      `${result.stdout}${result.stderr}`,
      home,
    ),
    denySpooled: denyCount(data),
    credentialUntouched: true,
  };
}

describe("live real CLIs block the sentinel command and run it once disabled", () => {
  // @req R-POL-09 @req R-POL-02
  it.runIf(LIVE)(
    "claude: real Claude Code CLI",
    async () => {
      const dir = workspace("claude-live");
      const blocked = await driveClaude(dir, true);
      expect(blocked.credentialUntouched).toBe(true);
      expect(blocked.sentinelPresent).toBe(false);
      expect(blocked.denySpooled).toBeGreaterThanOrEqual(1);
      expect(blocked.reasonSurfaced).toBe(true);
      const allowed = await driveClaude(dir, false);
      expect(allowed.sentinelPresent).toBe(true);
      expect(allowed.denySpooled).toBe(0);
      record(
        "claude",
        "real Claude Code CLI",
        "hook denied Bash, file absent, reason shown",
        "Bash ran, file created",
      );
    },
    240_000,
  );

  // @req R-POL-09 @req R-POL-02
  it.runIf(LIVE)(
    "codex: real Codex CLI",
    async () => {
      const dir = workspace("codex-live");
      const blocked = await driveCodex(dir, true);
      expect(blocked.credentialUntouched).toBe(true);
      expect(blocked.sentinelPresent).toBe(false);
      expect(blocked.denySpooled).toBeGreaterThanOrEqual(1);
      expect(blocked.reasonSurfaced).toBe(true);
      const allowed = await driveCodex(dir, false);
      expect(allowed.sentinelPresent).toBe(true);
      expect(allowed.denySpooled).toBe(0);
      record(
        "codex",
        "real Codex CLI",
        "hook denied the shell call, file absent, reason shown",
        "shell call ran, file created",
      );
    },
    240_000,
  );

  // @req R-POL-09 @req R-POL-02
  it.runIf(LIVE)(
    "gemini: real Gemini CLI",
    async () => {
      expect(existsSync(geminiKeyFile)).toBe(true);
      const dir = workspace("gemini-live");
      const blocked = await driveGemini(dir, true);
      expect(blocked.sentinelPresent).toBe(false);
      expect(blocked.denySpooled).toBeGreaterThanOrEqual(1);
      expect(blocked.reasonSurfaced).toBe(true);
      const allowed = await driveGemini(dir, false);
      expect(allowed.sentinelPresent).toBe(true);
      expect(allowed.denySpooled).toBe(0);
      record(
        "gemini",
        "real Gemini CLI",
        "hook denied run_shell_command, file absent, reason shown",
        "run_shell_command ran, file created",
      );
    },
    240_000,
  );
});
