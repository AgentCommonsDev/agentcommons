import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { agentInstructions } from "../../packages/hook/src/install.js";
import {
  recallDecision,
  recallDecisionPrompt,
  recallTaskPrompt,
  runNative,
  type RecallStageEnvironment,
} from "../live-harnesses.js";
import type { CapturedHarness } from "./capture.js";
import {
  initRepository,
  nativeSessions,
  plain,
  resultOf,
  rootSessionsWith,
  toolUses,
  waitUntil,
  type CanaryContext,
} from "./support.js";

const valueIn = async (cwd: string) =>
  z
    .object({ [recallDecision.key]: z.number() })
    .parse(JSON.parse(await readFile(join(cwd, recallDecision.file), "utf8")))[
    recallDecision.key
  ];
const wrongConfig = `${JSON.stringify({ [recallDecision.key]: recallDecision.wrong }, null, 2)}\n`;
// The canary's harnesses run against the operator's real home, so the guidance the
// installer would place in the global instructions files is supplied through the
// repository file here; the text is the same §8.3 block.
const instructionFiles = Object.fromEntries(
  ["CLAUDE.md", "AGENTS.md", "GEMINI.md"].map((name) => [
    name,
    `# Canary repository\n\n${agentInstructions}\n`,
  ]),
);

/**
 * Organic recall (R-MCP-10): with nothing but the installed registration and the
 * repository snippet the installer prints, an ordinary task that never mentions
 * AgentCommons must make the harness search before it writes, find the hooked session
 * that made the decision, and restore what it decided.
 */
export async function organicRecallStage(
  context: CanaryContext,
  { definition, environment }: CapturedHarness,
) {
  const recall = definition.recall;
  if (recall === null) return;
  const { database, organizationId } = context;
  console.log(`Running ${definition.cli} organic recall stage.`);
  const recallRepository = join(environment.directory, "recall-repo");
  const git = (cwd: string, args: string[], log: string) =>
    runNative("git", args, {
      cwd,
      env: environment.env,
      log: join(environment.directory, log),
    });
  // The evidence and the decision live only in the first repository's session.
  for (const [name, content] of Object.entries({
    "latency.txt": recallDecision.evidence,
    [recallDecision.file]: wrongConfig,
    ...instructionFiles,
  }))
    await writeFile(join(environment.repository, name), content);
  await git(environment.repository, ["add", "-A"], "git-add-recall.txt");
  await git(
    environment.repository,
    ["commit", "-m", "test: add upstream config and latency sample"],
    "git-commit-recall.txt",
  );
  // The task repository starts from the wrong value with no history of the right one.
  await mkdir(recallRepository, { mode: 0o700 });
  await initRepository({
    cwd: recallRepository,
    env: environment.env,
    logDirectory: environment.directory,
    logSuffix: "-recall-task",
    files: { [recallDecision.file]: wrongConfig, ...instructionFiles },
    message: "test: import upstream client config",
  });
  const stage: RecallStageEnvironment = {
    ...environment,
    marker: `acdec${context.runId}${definition.cli}`,
    ticket: `acorg${context.runId}${definition.cli}`,
    recallRepository,
  };
  const prompts = {
    decision_prompt: recallDecisionPrompt(stage),
    task_prompt: recallTaskPrompt(stage),
  };
  const partial = (extra: Record<string, unknown>) => ({
    harness: definition.harness,
    supported: true,
    passed: false,
    ...prompts,
    ...extra,
  });
  try {
    await recall(stage);
  } catch (error) {
    context.report.organic_recall.push(
      partial({
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    throw error;
  }
  let latest: { decisionId: string | null; taskId: string | null } = {
    decisionId: null,
    taskId: null,
  };
  const { decision, task } = await waitUntil(
    async () => {
      const sessions = await nativeSessions(
        database,
        organizationId,
        definition.harness,
      );
      const decisions = rootSessionsWith(sessions, stage.marker);
      const tasks = rootSessionsWith(sessions, stage.ticket);
      assert.ok(
        decisions.length <= 1 && tasks.length <= 1,
        `${definition.cli} created duplicate organic recall sessions.`,
      );
      latest = {
        decisionId: decisions[0]?.id ?? null,
        taskId: tasks[0]?.id ?? null,
      };
      return decisions[0]?.status === "ENDED" &&
        tasks[0]?.status === "ENDED" &&
        tasks[0].messages.some(
          (message) => message.role === "ASSISTANT" && message.kind === "TEXT",
        )
        ? { decision: decisions[0], task: tasks[0] }
        : undefined;
    },
    {
      timeoutMs: 120_000,
      onTimeout: () => {
        context.report.organic_recall.push(
          partial({
            decision_session_id: latest.decisionId,
            task_session_id: latest.taskId,
          }),
        );
        return new Error(
          `${definition.cli} did not ingest both organic recall sessions; private state: ${environment.installation}`,
        );
      },
    },
  );
  const decided = await valueIn(environment.repository);
  const restored = await valueIn(recallRepository);
  const uses = toolUses(task);
  const searchTool = definition.mcpTool("search");
  const searches = uses.filter((use) => use.tool_name === searchTool);
  const firstSearch = uses.findIndex((use) => use.tool_name === searchTool);
  // The value appears in neither the prompt nor the repository, so the first call
  // outside AgentCommons that carries it is the write that used what search returned.
  const carriesValue = new RegExp(`\\b${String(recallDecision.right)}\\b`);
  const firstWrite = uses.findIndex(
    (use) =>
      !use.tool_name?.startsWith(definition.mcpTool("")) &&
      carriesValue.test(
        `${use.content} ${JSON.stringify(use.tool_input ?? null)}`,
      ),
  );
  const searchFoundDecision = searches.some((use) =>
    plain(resultOf(task, use)?.content ?? "").includes(decision.id),
  );
  const reply =
    [...task.messages]
      .reverse()
      .find(
        (message) => message.role === "ASSISTANT" && message.kind === "TEXT",
      )?.content ?? "";
  const searchedBeforeWrite =
    firstSearch !== -1 && (firstWrite === -1 || firstSearch < firstWrite);
  const replyHasValue = carriesValue.test(reply);
  context.report.organic_recall.push({
    harness: definition.harness,
    supported: true,
    passed:
      decided === recallDecision.right &&
      searchedBeforeWrite &&
      searchFoundDecision &&
      restored === recallDecision.right &&
      replyHasValue,
    ...prompts,
    decision_session_id: decision.id,
    task_session_id: task.id,
    task_native_session_id: task.harnessSessionId,
    invoked: uses.map((use) => use.tool_name),
    search_queries: searches.map((use) => use.tool_input),
    searched_before_write: searchedBeforeWrite,
    search_found_decision: searchFoundDecision,
    decided_value: decided,
    restored_value: restored,
    reply_has_value: replyHasValue,
  });
  assert.equal(
    decided,
    recallDecision.right,
    `${definition.cli} decision session did not record the value.`,
  );
  assert.ok(
    firstSearch !== -1,
    `${definition.cli} never searched AgentCommons during an ordinary task; see organic_recall in the report.`,
  );
  assert.ok(
    searchedBeforeWrite,
    `${definition.cli} wrote the value before searching AgentCommons.`,
  );
  assert.ok(
    searchFoundDecision,
    `${definition.cli} search did not return the decision session.`,
  );
  assert.equal(
    restored,
    recallDecision.right,
    `${definition.cli} did not restore the decided value.`,
  );
  assert.ok(replyHasValue, `${definition.cli} reply omits the value.`);
  console.log(
    `${definition.cli}: searched AgentCommons unprompted, found the decision session and restored ${String(recallDecision.right)}.`,
  );
}
