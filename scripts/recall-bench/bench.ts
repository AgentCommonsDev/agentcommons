/**
 * Recall bench (ADR 0070): does a Claude Code agent consult AgentCommons, unprompted,
 * on an ordinary task? Not part of CI: it needs Docker, the `claude` CLI and a signed-in
 * Claude Code credential.
 *
 *   node --import tsx scripts/recall-bench/bench.ts --out <dir> --label baseline \
 *     --port 3031 [--runs 2] [--parallel 4] [--history squashed,available] \
 *     [--tasks cache,retry,timeout,validation,export,region] [--model <id>] \
 *     [--bundle packages/hook/dist/hook.js] [--credentials ~/.claude/.credentials.json] \
 *     [--hint on|off] [--registration ok|placeholder]
 *
 * Method (the same as ADR 0057): a private API on its own PostgreSQL and ClickHouse, one
 * organization, an installation wired into an isolated config home. Six hooked seed
 * sessions record decisions in one repository. Each task repository then drops the
 * evidence and regresses the value, with the history squashed to one commit or left in
 * place; every task runs `--runs` times per condition. The bench records, per run, the
 * order of tool calls (first AgentCommons call versus first write), each AgentCommons
 * call's query and hit count from the tool result, the matched session ids from the API
 * audit rows under the run's own read key, the hook context the model saw, and whether
 * the repository ends up carrying the decision. Task sessions are hidden from the member
 * keys as soon as they are indexed so later runs cannot find earlier runs.
 *
 * Ablations: `--hint off` runs the tasks with the capture hook disabled (guidance and
 * tools only, the ADR 0057 condition); `--registration placeholder` writes the harness's
 * MCP entry with an unexpanded `${AGENTCOMMONS_API_KEY}` and no such variable, the
 * production failure of 2026-09-11 (the handshake gets 401 and the harness drops the
 * server), to see what the model does with a hint it cannot act on.
 *
 * The isolated `CLAUDE_CONFIG_DIR` receives a copy of the credential file; the bench waits
 * whenever that credential is within 12 minutes of expiry and re-copies it after the real
 * client refreshed it, so the copy never performs a refresh of its own. Nothing under the
 * user's home is written.
 */
import { spawn, execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { startApp } from "../../apps/api/test/app.js";
import {
  provisionMember,
  provisionOrganization,
} from "../../apps/api/test/support.js";
import { configSchema } from "../../packages/hook/src/config.js";
import { refreshRecallHint } from "../../packages/hook/src/recall.js";
import { startTraceDatabase } from "../../packages/traces/test/support.js";
import {
  nativeSessions,
  rootSessionsWith,
  waitUntil,
} from "../canary/support.js";
import { REMOTE, benchTasks, type BenchTask, type History } from "./tasks.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const sha256 = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");

function argument(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value ?? fallback;
}
export const options = {
  out: resolve(argument("out", join(root, "node_modules/.cache/recall-bench"))),
  label: argument("label", "run"),
  port: Number(argument("port", "3031")),
  runs: Number(argument("runs", "2")),
  parallel: Number(argument("parallel", "4")),
  histories: argument("history", "squashed,available").split(",") as History[],
  tasks: argument("tasks", benchTasks.map((task) => task.id).join(",")).split(
    ",",
  ),
  model: argument("model", ""),
  bundle: resolve(argument("bundle", join(root, "packages/hook/dist/hook.js"))),
  credentials: resolve(
    argument("credentials", join(homedir(), ".claude/.credentials.json")),
  ),
  timeoutMs: Number(argument("timeout", String(12 * 60_000))),
  hint: argument("hint", "on") as "on" | "off",
  registration: argument("registration", "ok") as "ok" | "placeholder",
};
const runId = randomUUID().slice(0, 6);

// ---------------------------------------------------------------------------------------
// Credential guard
// ---------------------------------------------------------------------------------------
const credentialSchema = z.looseObject({
  claudeAiOauth: z.looseObject({ expiresAt: z.number() }).optional(),
});
let copiedCredential = "";
/** Copies the credential into the isolated config directory; waits out the refresh window. */
async function ensureCredential(configDirectory: string): Promise<void> {
  for (;;) {
    const bytes = await readFile(options.credentials, "utf8");
    const parsed = credentialSchema.parse(JSON.parse(bytes));
    const expiresAt =
      parsed.claudeAiOauth?.expiresAt ?? Number.POSITIVE_INFINITY;
    const remaining = expiresAt - Date.now();
    if (remaining > 12 * 60_000) {
      const digest = sha256(bytes);
      if (digest !== copiedCredential) {
        await writeFile(join(configDirectory, ".credentials.json"), bytes, {
          mode: 0o600,
        });
        copiedCredential = digest;
      }
      return;
    }
    console.log(
      `Credential expires in ${String(Math.round(remaining / 60_000))} min; waiting for the real client to refresh it.`,
    );
    await delay(30_000);
  }
}

// ---------------------------------------------------------------------------------------
// Repositories
// ---------------------------------------------------------------------------------------
const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: "Bench",
  GIT_AUTHOR_EMAIL: "bench@example.com",
  GIT_COMMITTER_NAME: "Bench",
  GIT_COMMITTER_EMAIL: "bench@example.com",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
};
function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, env: gitEnv, encoding: "utf8" });
}
async function writeFiles(
  directory: string,
  files: Record<string, string | null>,
): Promise<void> {
  for (const [name, content] of Object.entries(files)) {
    const path = join(directory, name);
    if (content === null) await rm(path, { force: true });
    else {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content);
    }
  }
}
async function readFiles(
  directory: string,
  names: readonly string[],
): Promise<Record<string, string | null>> {
  const entries: [string, string | null][] = await Promise.all(
    names.map(async (name): Promise<[string, string | null]> => [
      name,
      await readFile(join(directory, name), "utf8").catch(() => null),
    ]),
  );
  return Object.fromEntries(entries);
}
async function seedRepository(task: BenchTask, directory: string) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFiles(directory, task.seed);
  git(directory, ["init", "-q", "--initial-branch=main"]);
  git(directory, ["remote", "add", "origin", REMOTE]);
  git(directory, ["add", "-A"]);
  git(directory, ["commit", "-q", "-m", "chore: import orders-api"]);
}
/** The task repository: the seed repository after its session, regressed, history kept or squashed. */
async function taskRepository(
  task: BenchTask,
  seedDirectory: string,
  directory: string,
  history: History,
) {
  await mkdir(dirname(directory), { recursive: true, mode: 0o700 });
  await cp(seedDirectory, directory, {
    recursive: true,
    filter: (source) =>
      history === "available" || !source.includes(`${seedDirectory}/.git`),
  });
  await writeFiles(directory, task.regression);
  if (history === "squashed") {
    git(directory, ["init", "-q", "--initial-branch=main"]);
    git(directory, ["remote", "add", "origin", REMOTE]);
    git(directory, ["add", "-A"]);
    git(directory, ["commit", "-q", "-m", "chore: import orders-api"]);
  } else {
    git(directory, ["add", "-A"]);
    git(directory, ["commit", "-q", "-m", task.regressionMessage]);
  }
}

// ---------------------------------------------------------------------------------------
// Claude Code runs
// ---------------------------------------------------------------------------------------
export interface ToolCall {
  at: number;
  id: string | null;
  name: string;
  input: unknown;
  /** The tool result text, when the stream carried one. */
  result: string | null;
}
export interface ClaudeRun {
  sessionId: string | null;
  model: string | null;
  mcpStatus: string | null;
  exitCode: number | null;
  durationMs: number;
  calls: ToolCall[];
  reply: string;
  costUsd: number | null;
}
const streamSchema = z.looseObject({
  type: z.string(),
  subtype: z.string().optional(),
  session_id: z.string().optional(),
  model: z.string().optional(),
  mcp_servers: z
    .array(z.looseObject({ name: z.string(), status: z.string() }))
    .optional(),
  message: z
    .looseObject({
      content: z
        .union([
          z.string(),
          z.array(
            z.looseObject({
              type: z.string(),
              id: z.string().optional(),
              name: z.string().optional(),
              input: z.unknown().optional(),
              tool_use_id: z.string().optional(),
              content: z.unknown().optional(),
              text: z.string().optional(),
            }),
          ),
        ])
        .optional(),
    })
    .optional(),
  result: z.string().optional(),
  total_cost_usd: z.number().optional(),
});
const textBlockSchema = z.looseObject({ text: z.string().optional() });
/** The text of a content value: a string, or the text blocks of an array. */
export function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content
      .map((item: unknown) =>
        typeof item === "string"
          ? item
          : (textBlockSchema.safeParse(item).data?.text ?? ""),
      )
      .join("\n");
  return "";
}
/**
 * One run from its logged stream lines (`<ms> <json>`; stderr lines are skipped): the
 * init facts, every tool call in order with its result, and the final reply.
 */
export function parseStream(lines: readonly string[]): ClaudeRun {
  const run: ClaudeRun = {
    sessionId: null,
    model: null,
    mcpStatus: null,
    exitCode: null,
    durationMs: 0,
    calls: [],
    reply: "",
    costUsd: null,
  };
  const results = new Map<string, string>();
  for (const logged of lines) {
    const space = logged.indexOf(" ");
    const prefix = logged.slice(0, space);
    if (!/^\d+$/.test(prefix)) continue;
    const at = Number(prefix);
    let event: z.infer<typeof streamSchema>;
    try {
      event = streamSchema.parse(JSON.parse(logged.slice(space + 1)));
    } catch {
      continue;
    }
    if (event.type === "system" && event.subtype === "init") {
      run.sessionId = event.session_id ?? null;
      run.model = event.model ?? null;
      run.mcpStatus =
        event.mcp_servers?.find((server) => server.name === "agentcommons")
          ?.status ?? "absent";
    }
    const content = event.message?.content;
    if (event.type === "assistant" && Array.isArray(content))
      for (const block of content)
        if (block.type === "tool_use" && block.name)
          run.calls.push({
            at,
            id: block.id ?? null,
            name: block.name,
            input: block.input,
            result: null,
          });
    if (event.type === "user" && Array.isArray(content))
      for (const block of content)
        if (block.type === "tool_result" && block.tool_use_id)
          results.set(block.tool_use_id, contentText(block.content));
    if (event.type === "result") {
      run.reply = event.result ?? "";
      run.costUsd = event.total_cost_usd ?? null;
      run.durationMs = at;
    }
  }
  for (const call of run.calls)
    call.result = call.id === null ? null : (results.get(call.id) ?? null);
  return run;
}
async function runClaude(input: {
  cwd: string;
  prompt: string;
  env: NodeJS.ProcessEnv;
  mcpConfig: string;
  log: string;
}): Promise<ClaudeRun> {
  const args = [
    "--print",
    "--output-format",
    "stream-json",
    "--verbose",
    "--mcp-config",
    input.mcpConfig,
    "--strict-mcp-config",
    "--allowedTools",
    "Read,Edit,Write,MultiEdit,Grep,Glob,Bash,mcp__agentcommons__*",
    ...(options.model ? ["--model", options.model] : []),
    "--",
    input.prompt,
  ];
  const started = Date.now();
  const lines: string[] = [];
  const exitCode = await new Promise<number | null>((resolveRun) => {
    const child = spawn("claude", args, {
      cwd: input.cwd,
      env: input.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), options.timeoutMs);
    let buffer = "";
    const handle = (line: string) => {
      if (line.trim()) lines.push(`${String(Date.now() - started)} ${line}`);
    };
    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const parts = buffer.split("\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) handle(part);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      lines.push(`stderr ${chunk.toString().trimEnd()}`);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (buffer) handle(buffer);
      resolveRun(code);
    });
  });
  await writeFile(input.log, lines.join("\n") + "\n", { mode: 0o600 });
  const run = parseStream(lines);
  run.exitCode = exitCode;
  run.durationMs = Date.now() - started;
  return run;
}

// ---------------------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------------------
export const AGENTCOMMONS = "mcp__agentcommons__";
const WRITE_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const writingBash =
  /(^|[\s;&|])(sed\s+-i|tee\b|git\s+commit|git\s+add|mv\s|cp\s|rm\s|npm\s+install|>\s*[^&\s])/;
export function isWrite(call: ToolCall): boolean {
  if (WRITE_TOOLS.has(call.name)) return true;
  if (call.name !== "Bash") return false;
  const command = z
    .looseObject({ command: z.string().optional() })
    .safeParse(call.input).data?.command;
  return command !== undefined && writingBash.test(command);
}
/**
 * The hit count the agent saw. Claude Code 2.1.266 hands the model the structured JSON
 * result (`total.hits`), not the text rendering; the text form is read as a fallback.
 */
export function hitsOf(call: ToolCall): number | null {
  if (call.name !== `${AGENTCOMMONS}search` || call.result === null)
    return null;
  const structured = z
    .looseObject({ total: z.looseObject({ hits: z.number() }) })
    .safeParse(
      (() => {
        try {
          return JSON.parse(call.result) as unknown;
        } catch {
          return null;
        }
      })(),
    );
  if (structured.success) return structured.data.total.hits;
  const match = /^(\d+) hits? in/.exec(call.result);
  return match ? Number(match[1]) : null;
}
const hintSchema = z.looseObject({
  attachment: z
    .looseObject({ type: z.string(), content: z.unknown().optional() })
    .optional(),
});
/** Every hook context line the model saw in this session, from the isolated transcript. */
export async function hintsSeen(
  configDirectory: string,
  sessionId: string | null,
): Promise<string[]> {
  if (!sessionId) return [];
  const projects = join(configDirectory, "projects");
  const hints: string[] = [];
  try {
    for (const project of await readdir(projects)) {
      const path = join(projects, project, `${sessionId}.jsonl`);
      try {
        await stat(path);
      } catch {
        continue;
      }
      for (const line of (await readFile(path, "utf8")).split("\n")) {
        let parsed: unknown = null;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }
        const record = hintSchema.safeParse(parsed);
        if (
          record.success &&
          record.data.attachment?.type === "hook_additional_context"
        )
          hints.push(contentText(record.data.attachment.content));
      }
    }
  } catch {
    /* No transcript. */
  }
  return hints;
}
export interface RecallCall {
  tool: string;
  input: unknown;
  hits: number | null;
  at_ms: number;
}
export interface RunRecord {
  task: string;
  history: History;
  run: number;
  ticket: string;
  session_id: string | null;
  model: string | null;
  mcp_status: string | null;
  exit_code: number | null;
  duration_ms: number;
  cost_usd: number | null;
  tools: string[];
  /** Every AgentCommons call in order, with the hit count the agent saw. */
  recall: RecallCall[];
  first_recall_tool: string | null;
  first_recall_input: unknown;
  first_recall_at_ms: number | null;
  first_write_at_ms: number | null;
  searched_before_write: boolean;
  recall_calls: number;
  /** From the audit rows of the run's own key: action, query and matched session ids. */
  audit: { action: string; input: unknown; sessions: string[] }[];
  first_result_has_seed: boolean;
  any_result_has_seed: boolean;
  any_result_has_task_run: boolean;
  hints: string[];
  used_decision: boolean;
  /** The reply names the repair command the hint asked for (registration ablation). */
  reply_asks_repair: boolean;
  reply: string;
}
export function scoreRun(input: {
  task: BenchTask;
  history: History;
  run: number;
  ticket: string;
  result: ClaudeRun;
  audit: RunRecord["audit"];
  seedIds: ReadonlySet<string>;
  taskSessionIds: ReadonlySet<string>;
  hints: string[];
  files: Record<string, string | null>;
}): RunRecord {
  const { result, audit } = input;
  const firstRecall = result.calls.findIndex((call) =>
    call.name.startsWith(AGENTCOMMONS),
  );
  const firstWrite = result.calls.findIndex(isWrite);
  const first = firstRecall === -1 ? undefined : result.calls[firstRecall];
  return {
    task: input.task.id,
    history: input.history,
    run: input.run,
    ticket: input.ticket,
    session_id: result.sessionId,
    model: result.model,
    mcp_status: result.mcpStatus,
    exit_code: result.exitCode,
    duration_ms: result.durationMs,
    cost_usd: result.costUsd,
    tools: result.calls.map((call) => call.name),
    recall: result.calls
      .filter((call) => call.name.startsWith(AGENTCOMMONS))
      .map((call) => ({
        tool: call.name.slice(AGENTCOMMONS.length),
        input: call.input,
        hits: hitsOf(call),
        at_ms: call.at,
      })),
    first_recall_tool: first?.name.slice(AGENTCOMMONS.length) ?? null,
    first_recall_input: first?.input ?? null,
    first_recall_at_ms: first?.at ?? null,
    first_write_at_ms:
      firstWrite === -1 ? null : (result.calls[firstWrite]?.at ?? null),
    searched_before_write:
      firstRecall !== -1 && (firstWrite === -1 || firstRecall < firstWrite),
    recall_calls: result.calls.filter((call) =>
      call.name.startsWith(AGENTCOMMONS),
    ).length,
    audit,
    first_result_has_seed:
      audit[0]?.sessions.some((id) => input.seedIds.has(id)) ?? false,
    any_result_has_seed: audit.some((row) =>
      row.sessions.some((id) => input.seedIds.has(id)),
    ),
    any_result_has_task_run: audit.some((row) =>
      row.sessions.some((id) => input.taskSessionIds.has(id)),
    ),
    hints: input.hints,
    used_decision: input.task.usedDecision(input.files),
    reply_asks_repair:
      /hook\.js install|install needs repair|AgentCommons install/i.test(
        result.reply,
      ),
    reply: result.reply.slice(0, 600),
  };
}
export function summarize(
  records: readonly RunRecord[],
  histories: readonly History[],
): string {
  const rate = (
    rows: readonly RunRecord[],
    pick: (row: RunRecord) => boolean,
  ) => `${String(rows.filter(pick).length)}/${String(rows.length)}`;
  const median = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
  };
  const lines = [
    "| condition | searched before write | first call has seed | first call hits > 0 | used decision | hinted | first recall call p50 |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const history of histories) {
    const rows = records.filter((record) => record.history === history);
    const p50 =
      median(
        rows.flatMap((row) =>
          row.first_recall_at_ms === null ? [] : [row.first_recall_at_ms],
        ),
      ) ?? null;
    lines.push(
      `| ${history} | ${rate(rows, (r) => r.searched_before_write)} | ${rate(rows, (r) => r.first_result_has_seed)} | ${rate(rows, (r) => (r.recall[0]?.hits ?? 0) > 0)} | ${rate(rows, (r) => r.used_decision)} | ${rate(rows, (r) => r.hints.length > 0)} | ${p50 === null ? "n/a" : `${(p50 / 1000).toFixed(1)} s`} |`,
    );
  }
  lines.push(
    "",
    "| task | history | run | first tool | first call | hits | before write | seed found | decision | hint | repair |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  );
  for (const record of records)
    lines.push(
      `| ${record.task} | ${record.history} | ${String(record.run)} | ${String(record.first_recall_tool)} | ${JSON.stringify(
        record.first_recall_input ?? null,
      )
        .replaceAll("|", "\\|")
        .slice(
          0,
          90,
        )} | ${String(record.recall[0]?.hits ?? "")} | ${String(record.searched_before_write)} | ${String(record.any_result_has_seed)} | ${String(record.used_decision)} | ${String(record.hints.length)} | ${String(record.reply_asks_repair)} |`,
    );
  return lines.join("\n");
}

// ---------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------
async function main() {
  const out = options.out;
  await mkdir(out, { recursive: true, mode: 0o700 });
  console.log(
    `Recall bench ${options.label} (${runId}) in ${out}; hint ${options.hint}, registration ${options.registration}`,
  );
  const bundleBytes = await readFile(options.bundle);
  console.log(`Bundle ${options.bundle} sha256 ${sha256(bundleBytes)}`);
  const database = await startTraceDatabase();
  const publicUrl = `http://127.0.0.1:${String(options.port)}`;
  const started = await startApp(
    database,
    { PUBLIC_URL: publicUrl, TRUST_PROXY: "loopback" },
    { listen: true, port: options.port, jobs: true },
  );
  const { runtime } = started;
  try {
    const owner = await provisionOrganization(database, "bench-owner", {
      verified: true,
    });
    const member = await provisionMember(
      database,
      owner.owner,
      "bench-member@example.com",
      { verified: true },
    );
    const organizationId = z
      .string()
      .parse(member.context.caller?.organizationId);
    const keyOf = async (name: string, read: boolean) => {
      const created = z
        .looseObject({
          key: z.string(),
          metadata: z.looseObject({ id: z.string() }),
        })
        .parse(
          (
            await database.auth.createKey(member.owner, {
              name,
              permissions: { sessions: read ? ["read"] : ["ingest", "read"] },
            })
          ).result,
        );
      return { id: created.metadata.id, key: created.key };
    };
    const installKey = await keyOf("bench installation", false);
    // The installation: a private data directory and an isolated config home.
    const installation = join(out, "installation");
    const configHome = join(out, "config-home");
    const configDirectory = join(configHome, ".claude");
    await mkdir(installation, { recursive: true, mode: 0o700 });
    await mkdir(configDirectory, { recursive: true, mode: 0o700 });
    const hook = join(installation, "hook.js");
    await writeFile(hook, bundleBytes);
    const childEnv: NodeJS.ProcessEnv = {
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          ([name]) =>
            !name.startsWith("CLAUDE") && !name.startsWith("AGENTCOMMONS_"),
        ),
      ),
      AGENTCOMMONS_DIR: installation,
      AGENTCOMMONS_SERVER: publicUrl,
      AGENTCOMMONS_API_KEY: installKey.key,
      AGENTCOMMONS_DISABLE: "0",
      CLAUDE_CONFIG_DIR: configDirectory,
    };
    const shim = (mode: string, args: string[], input?: string) =>
      execFileSync(process.execPath, [hook, mode, ...args], {
        env: childEnv,
        input,
        encoding: "utf8",
      });
    shim(
      "configure",
      [],
      JSON.stringify({
        server: publicUrl,
        key: installKey.key,
        node: process.execPath,
      }),
    );
    console.log(
      shim("install", ["--config-home", configHome, "--no-shell-rc"]).trim(),
    );
    const config = configSchema.parse(
      JSON.parse(await readFile(join(installation, "config.json"), "utf8")),
    );
    await ensureCredential(configDirectory);
    const tasks = benchTasks.filter((task) => options.tasks.includes(task.id));
    const mcpConfigFor = async (name: string, key: string) => {
      const path = join(out, "mcp", `${name}.json`);
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await writeFile(
        path,
        JSON.stringify({
          mcpServers: {
            agentcommons: {
              type: "http",
              url: `${publicUrl}/mcp`,
              headers: { Authorization: `Bearer ${key}` },
              alwaysLoad: true,
            },
          },
        }),
        { mode: 0o600 },
      );
      return path;
    };
    // Seeds: hooked sessions that make the decisions, in parallel.
    const seedMcp = await mcpConfigFor("seed", installKey.key);
    const seeds = new Map<string, string>();
    await Promise.all(
      tasks.map(async (task) => {
        const directory = join(out, "seed", task.id);
        await seedRepository(task, directory);
        seeds.set(task.id, directory);
        await ensureCredential(configDirectory);
        const run = await runClaude({
          cwd: directory,
          prompt: `${task.seedPrompt} Ticket ACSEED-${task.id.toUpperCase()}-${runId}.`,
          env: childEnv,
          mcpConfig: seedMcp,
          log: join(out, "seed", `${task.id}.stream.jsonl`),
        });
        console.log(
          `seed ${task.id}: exit ${String(run.exitCode)}, ${String(run.calls.length)} tool calls, ${String(Math.round(run.durationMs / 1000))} s, model ${String(run.model)}`,
        );
      }),
    );
    // Every seed session indexed and ended before any task starts.
    const seedSessions = await waitUntil(
      async () => {
        const sessions = await nativeSessions(
          database,
          organizationId,
          "CLAUDE_CODE",
        );
        const found = new Map<string, string>();
        for (const task of tasks) {
          const seed = rootSessionsWith(
            sessions,
            `ACSEED-${task.id.toUpperCase()}-${runId}`,
          )[0];
          if (seed?.status === "ENDED") found.set(task.id, seed.id);
        }
        return found.size === tasks.length ? found : undefined;
      },
      {
        timeoutMs: 180_000,
        onTimeout: () => new Error("The seed sessions were not indexed."),
      },
    );
    for (const task of tasks)
      console.log(
        `seed ${task.id}: session ${seedSessions.get(task.id) ?? "?"}, decision recorded ${String(
          task.seedRecorded(
            await readFiles(seeds.get(task.id) ?? "", task.seedFiles),
          ),
        )}`,
      );
    // A fresh recall cache: the hook hints from what the uploader would have cached by now.
    await rm(join(installation, "recall"), { recursive: true, force: true });
    console.log(
      `recall cache: ${await refreshRecallHint(installation, config, {
        root: seeds.values().next().value ?? out,
        remoteUrl: REMOTE,
        branch: "main",
        head: null,
      })}`,
    );
    // The registration ablation: the installer-written Claude entry carries the
    // placeholder and the variable is absent, as on the production machines of 2026-09-11.
    const taskEnv: NodeJS.ProcessEnv = {
      ...childEnv,
      ...(options.hint === "off" ? { AGENTCOMMONS_DISABLE: "1" } : {}),
    };
    let brokenMcp: string | null = null;
    if (options.registration === "placeholder") {
      const claudeJson = join(configHome, ".claude.json");
      const document = z
        .looseObject({
          mcpServers: z.record(z.string(), z.looseObject({})),
        })
        .parse(JSON.parse(await readFile(claudeJson, "utf8")));
      document.mcpServers.agentcommons = {
        type: "http",
        url: `${publicUrl}/mcp`,
        headers: { Authorization: "Bearer ${AGENTCOMMONS_API_KEY}" },
        alwaysLoad: true,
      };
      await writeFile(claudeJson, `${JSON.stringify(document, null, 2)}\n`, {
        mode: 0o600,
      });
      brokenMcp = claudeJson;
      Reflect.deleteProperty(taskEnv, "AGENTCOMMONS_API_KEY");
    }
    // Task runs, bounded parallelism, run 1 of every task before run 2.
    const plan: { task: BenchTask; history: History; run: number }[] = [];
    for (let run = 1; run <= options.runs; run++)
      for (const history of options.histories)
        for (const task of tasks) plan.push({ task, history, run });
    const records: RunRecord[] = [];
    const taskSessionIds = new Set<string>();
    const seedIds = new Set(seedSessions.values());
    let cursor = 0;
    const worker = async () => {
      for (;;) {
        const item = plan[cursor++];
        if (!item) return;
        const { task, history, run } = item;
        const name = `${task.id}-${history}-${String(run)}`;
        const ticket = `ACRB-${name.toUpperCase()}-${runId}`;
        const directory = join(out, "tasks", name);
        await taskRepository(
          task,
          seeds.get(task.id) ?? "",
          directory,
          history,
        );
        const key = await keyOf(`bench ${name}`, true);
        const mcpConfig = brokenMcp ?? (await mcpConfigFor(name, key.key));
        await ensureCredential(configDirectory);
        const result = await runClaude({
          cwd: directory,
          prompt: `${task.taskPrompt} Ticket ${ticket}.`,
          env: taskEnv,
          mcpConfig,
          log: join(out, "tasks", `${name}.stream.jsonl`),
        });
        const audit = (
          await database.prisma.auditEvent.findMany({
            where: {
              apiKeyId: key.id,
              action: { in: ["search", "get", "sql"] },
            },
            orderBy: { ts: "asc" },
          })
        ).map((row) => ({
          action: row.action,
          input:
            z
              .looseObject({ input: z.unknown().optional() })
              .safeParse(row.detail).data?.input ?? null,
          sessions: row.resourceIds,
        }));
        const record = scoreRun({
          task,
          history,
          run,
          ticket,
          result,
          audit,
          seedIds,
          taskSessionIds,
          hints: await hintsSeen(configDirectory, result.sessionId),
          files: await readFiles(directory, task.outcomeFiles),
        });
        records.push(record);
        console.log(
          `${name}: searched_before_write=${String(record.searched_before_write)} first=${String(record.first_recall_tool)} hits=${String(record.recall[0]?.hits ?? "")} found_seed=${String(record.any_result_has_seed)} used_decision=${String(record.used_decision)} hints=${String(record.hints.length)} repair=${String(record.reply_asks_repair)} mcp=${String(record.mcp_status)} ${String(Math.round(record.duration_ms / 1000))} s`,
        );
        await writeFile(
          join(out, `results-${options.label}.json`),
          JSON.stringify(
            { label: options.label, runId, options, records },
            null,
            2,
          ),
        );
        // Hide this run's own captured session so later runs cannot find it.
        if (options.hint === "off") continue;
        try {
          const own = await waitUntil(
            async () =>
              rootSessionsWith(
                await nativeSessions(database, organizationId, "CLAUDE_CODE"),
                ticket,
              )[0],
            {
              timeoutMs: 45_000,
              onTimeout: () => new Error("not indexed yet"),
            },
          );
          taskSessionIds.add(own.id);
          await runtime.services.admin.setVisibility(owner.owner, {
            session_id: own.id,
            visibility: "PRIVATE",
            reason: "recall bench: hide task runs from later runs",
          });
        } catch (error) {
          console.log(
            `${name}: could not hide its session (${error instanceof Error ? error.message : String(error)})`,
          );
        }
      }
    };
    await Promise.all(Array.from({ length: options.parallel }, () => worker()));
    const summary = summarize(records, options.histories);
    console.log(summary);
    await writeFile(join(out, `summary-${options.label}.md`), summary + "\n");
  } finally {
    await started.close().catch(() => undefined);
    await database.close().catch(() => undefined);
  }
}
if (process.argv[1] && /bench\.(ts|mjs|js)$/.test(process.argv[1]))
  void main().then(
    () => {
      process.exit(0);
    },
    (error: unknown) => {
      console.error(error);
      process.exit(1);
    },
  );
