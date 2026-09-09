import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Page } from "@playwright/test";
import type {
  provisionMember,
  provisionOrganization,
} from "../../apps/api/test/support.js";
import type { Harness } from "../../packages/core/schemas/common.js";
import type { startTraceDatabase } from "../../packages/traces/test/support.js";
import { runNative } from "../live-harnesses.js";

export type TraceDatabase = Awaited<ReturnType<typeof startTraceDatabase>>;
/** Report rows the stages append to; a failing stage records what it saw before throwing. */
export interface CanaryReport {
  harnesses: Array<Record<string, unknown>>;
  native_tools: Array<Record<string, unknown>>;
  organic_recall: Array<Record<string, unknown>>;
  catalog: Record<string, number> | null;
}
/** What every stage shares: the disposable API, its identities, the mobile page and the report. */
export interface CanaryContext {
  root: string;
  directory: string;
  runId: string;
  publicUrl: string;
  /** Where report.json and the screenshots go. */
  output: string;
  database: TraceDatabase;
  organizationId: string;
  administrator: Awaited<ReturnType<typeof provisionOrganization>>;
  member: Awaited<ReturnType<typeof provisionMember>>;
  /** A sessions-read key for the MCP and REST checks, distinct from the installed member key. */
  readKey: string;
  userClient: Client;
  page: Page;
  browserErrors: string[];
  report: CanaryReport;
}

/** Polls `check` once a second until it yields a value; at the deadline `onTimeout` builds the error. */
export async function waitUntil<T>(
  check: () => Promise<T | undefined>,
  options: { timeoutMs: number; onTimeout: () => Error | Promise<Error> },
): Promise<T> {
  const deadline = Date.now() + options.timeoutMs;
  for (;;) {
    const value = await check();
    if (value !== undefined) return value;
    if (Date.now() >= deadline) throw await options.onTimeout();
    await delay(1000);
  }
}

/** Every published session of one harness with its messages, children and header fields. */
export async function nativeSessions(
  database: TraceDatabase,
  organizationId: string,
  harness: Harness,
) {
  const controls = await database.prisma.traceSessionControl.findMany({
    where: {
      organizationId,
      harness,
      purgedAt: null,
      publishedRevision: { gt: 0 },
    },
  });
  const result = [];
  for (const control of controls) {
    if (control.acceptedRevision !== control.publishedRevision) continue;
    const scope = {
      organizationId,
      sessionId: control.id,
      revision: control.publishedRevision,
      generation: control.redactionGeneration,
    };
    const header = await database.traces.readSession(
      organizationId,
      control.id,
      scope.revision,
      scope.generation,
    );
    if (!header) continue;
    const messages = [];
    let after: string | null = null;
    do {
      const page = await database.traces.messagesPage(scope, {
        after,
        limit: 1000,
      });
      messages.push(...page.items);
      after = page.after;
    } while (after);
    result.push({
      ...control,
      messages,
      children: controls.filter(
        (child) =>
          child.parentSessionId === control.id &&
          child.acceptedRevision === child.publishedRevision,
      ),
      startCommit: header.start_commit,
      endCommit: header.end_commit,
      branch: header.branch,
      repoName: header.repo_name,
      dirtyFileCount: header.dirty_file_count,
      observedDiffStat: header.observed_diff_stat,
      observedCommits: header.observed_commits,
      messageCount: header.message_count,
      toolCallCount: header.tool_call_count,
    });
  }
  return result;
}
export type NativeSession = Awaited<ReturnType<typeof nativeSessions>>[number];
type NativeMessage = NativeSession["messages"][number];

/** Root sessions whose user prompt carries `text`; each stage marker must match at most one. */
export function rootSessionsWith(sessions: NativeSession[], text: string) {
  return sessions.filter(
    (candidate) =>
      candidate.parentSessionId === null &&
      candidate.messages.some(
        (message) => message.role === "USER" && message.content.includes(text),
      ),
  );
}
/** The `TOOL_RESULT` answering one `TOOL_USE`, if the session persisted it. */
export const resultOf = (session: NativeSession, use: NativeMessage) =>
  session.messages.find(
    (message) =>
      message.kind === "TOOL_RESULT" && message.tool_use_id === use.tool_use_id,
  );
/** Tool calls in transcript order. */
export const toolUses = (session: NativeSession) =>
  [...session.messages]
    .sort((a, b) => a.seq - b.seq)
    .filter((message) => message.kind === "TOOL_USE");
/** Gemini and Codex persist MCP text results inside JSON strings; compare unescaped. */
export const plain = (content: string) => content.replaceAll("\\", "");

/**
 * A canary repository: identity, one commit of `files`, and the fixed origin the
 * session header must report. Git output goes to `<logDirectory>/git-<step><logSuffix>.txt`.
 */
export async function initRepository(input: {
  cwd: string;
  env: NodeJS.ProcessEnv;
  logDirectory: string;
  logSuffix?: string;
  files: Record<string, string>;
  message: string;
}) {
  const git = (step: string, args: string[]) =>
    runNative("git", args, {
      cwd: input.cwd,
      env: input.env,
      log: join(input.logDirectory, `git-${step}${input.logSuffix ?? ""}.txt`),
    });
  await git("init", ["init", "--initial-branch=canary"]);
  await git("name", ["config", "user.name", "AgentCommons canary"]);
  await git("email", ["config", "user.email", "canary@example.com"]);
  for (const [name, content] of Object.entries(input.files))
    await writeFile(join(input.cwd, name), content);
  await git("add", ["add", "-A"]);
  await git("commit", ["commit", "-m", input.message]);
  await git("remote", [
    "remote",
    "add",
    "origin",
    "https://github.com/rek7/agentcommons.git",
  ]);
}
