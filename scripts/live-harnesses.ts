import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile, unlink, copyFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { finished } from "node:stream/promises";
import { parse, stringify } from "smol-toml";
import { z } from "zod";
import { nativeCompletionSchema } from "./canary-completion.js";

const root = fileURLToPath(new URL("../", import.meta.url));
export interface CanaryEnvironment {
  directory: string;
  repository: string;
  configHome: string;
  installation: string;
  marker: string;
  runId: string;
  env: NodeJS.ProcessEnv;
}

/** Native output stays private: it can contain credentials or source transcripts. */
export async function runNative(
  command: string,
  args: string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    log: string;
    input?: string;
    timeout?: number;
  },
) {
  const output = createWriteStream(options.log, { mode: 0o600 });
  const errors = createWriteStream(`${options.log}.stderr`, { mode: 0o600 });
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    detached: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdout.pipe(output);
  child.stderr.pipe(errors);
  child.stdin.on("error", () => {
    /* A failed native command may close stdin first. */
  });
  child.stdin.end(options.input);
  const terminate = () => {
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        /* Already exited. */
      }
    }
  };
  const timer = setTimeout(terminate, options.timeout ?? 600_000);
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    await Promise.all([finished(output), finished(errors)]);
    if (code !== 0)
      throw new Error(`${command} failed; private log: ${options.log}`);
  } finally {
    clearTimeout(timer);
    terminate();
  }
}

const shared = (options: CanaryEnvironment) => ({
  cwd: options.repository,
  env: options.env,
  log: join(options.directory, "native.jsonl"),
});
export const liveHarnesses = [
  {
    cli: "claude",
    harness: "CLAUDE_CODE",
    version: "2.1.263",
    links: "SUBAGENT",
    async run(options: CanaryEnvironment) {
      await runNative(
        "claude",
        [
          "--print",
          "--settings",
          join(options.configHome, ".claude/settings.json"),
          "--allowedTools",
          "Read,Agent",
          "--",
          `${options.marker}. Use Read to read probe.txt. Then use the Agent tool with subagent_type Explore to read the same file and report its exact content. Return the content.`,
        ],
        shared(options),
      );
    },
  },
  {
    cli: "codex",
    harness: "CODEX",
    version: "0.153.4",
    links: "SUBAGENT",
    async run(options: CanaryEnvironment) {
      const config = z
        .object({ hooks: z.record(z.string(), z.unknown()) })
        .parse(
          parse(
            await readFile(
              join(options.configHome, ".codex/config.toml"),
              "utf8",
            ),
          ),
        );
      const profile = `agentcommons-canary-${options.runId}`;
      const path = join(homedir(), ".codex", `${profile}.config.toml`);
      // This profile convention was captured live; never edit the user's config or auth.
      await writeFile(path, stringify({ hooks: config.hooks }), {
        mode: 0o600,
        flag: "wx",
      });
      try {
        await runNative(
          "codex",
          [
            "exec",
            "--profile",
            profile,
            "--dangerously-bypass-hook-trust",
            "--sandbox",
            "read-only",
            "-C",
            options.repository,
            "--model",
            "gpt-6-astra",
            "-c",
            'model_reasoning_effort="high"',
            `${options.marker}. Run cat probe.txt. Then use a subagent to independently read probe.txt and return its exact content; wait for it and reply with the content. Do not change files.`,
          ],
          shared(options),
        );
      } finally {
        await unlink(path);
      }
    },
  },
  {
    cli: "gemini",
    harness: "GEMINI_CLI",
    version: "0.35.3",
    links: null,
    async run(options: CanaryEnvironment) {
      await mkdir(join(options.repository, ".gemini"), { mode: 0o700 });
      await copyFile(
        join(options.configHome, ".gemini/settings.json"),
        join(options.repository, ".gemini/settings.json"),
      );
      await runNative(
        "gemini",
        [
          "--prompt",
          `${options.marker}. Use read_file to read probe.txt, then use run_shell_command to run printf capture-second-tool. Reply with the file content and command output.`,
          "--approval-mode",
          "yolo",
        ],
        shared(options),
      );
    },
  },
  {
    cli: "pi",
    harness: "PI",
    version: "0.73.1",
    links: "FORK",
    resume: true,
    async run(options: CanaryEnvironment) {
      const packageDirectory = dirname(
        dirname(
          fileURLToPath(import.meta.resolve("@mariozechner/pi-coding-agent")),
        ),
      );
      const input = join(options.directory, "pi-input.json");
      await writeFile(
        input,
        JSON.stringify({
          packageDirectory,
          directory: join(options.directory, "pi"),
          extension: join(options.installation, "pi-extension.mjs"),
          prompt: `${options.marker}. Use read to read probe.txt. Return the file content.`,
          output: join(options.directory, "pi-native-identities.json"),
        }),
        { mode: 0o600 },
      );
      await runNative(
        process.execPath,
        [join(root, "scripts/live-pi.mjs"), input],
        shared(options),
      );
      const result = z
        .object({
          originalId: z.string(),
          forkId: z.string(),
          completion: z.array(nativeCompletionSchema).length(2),
        })
        .parse(
          JSON.parse(
            await readFile(
              join(options.directory, "pi-native-identities.json"),
              "utf8",
            ),
          ),
        );
      if (
        ![result.originalId, result.forkId].every((id) =>
          result.completion.some((checkpoint) => checkpoint.sessionId === id),
        )
      )
        throw new Error("Native pi completion omitted a session shutdown.");
      return result.completion;
    },
  },
] as const;
