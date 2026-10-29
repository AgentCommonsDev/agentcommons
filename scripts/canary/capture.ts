import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "@playwright/test";
import { z } from "zod";
import { sessionsCopy } from "../../apps/dashboard/src/copy/sessions.js";
import { paths } from "../../apps/dashboard/src/lib/routes.js";
import { getOutputSchema } from "../../packages/core/schemas/get.js";
import { hookManifestSchema } from "../../packages/core/schemas/ingest.js";
import { searchOutputSchema } from "../../packages/core/schemas/search.js";
import { completedNativeSessions } from "../canary-completion.js";
import { verifyNativeTree } from "../canary-tree.js";
import {
  runNative,
  type CanaryEnvironment,
  type LiveHarness,
} from "../live-harnesses.js";
import {
  initRepository,
  nativeSessions,
  rootSessionsWith,
  waitUntil,
  type CanaryContext,
  type NativeSession,
} from "./support.js";

/** One harness the capture stage completed; the later stages reuse its installation. */
export interface CapturedHarness {
  definition: LiveHarness;
  environment: CanaryEnvironment;
  marker: string;
  sessionId: string;
}
const digest = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
const resumedMarker = (session: NativeSession) =>
  session.messages.find(
    (message) =>
      message.role === "SYSTEM" &&
      message.kind === "META" &&
      message.content.toLowerCase().includes("resum"),
  );

/**
 * Installs the hook into a private config home, runs the harness's scripted session in
 * a fresh repository, and proves the session arrived complete: uploaded, self-updated,
 * searchable and readable over REST and MCP, and rendered in the mobile dashboard.
 */
export async function captureHarness(
  context: CanaryContext,
  definition: LiveHarness,
): Promise<CapturedHarness> {
  const { database, organizationId, publicUrl, page, browserErrors } = context;
  console.log(`Running ${definition.cli} live canary.`);
  const workspace = join(context.directory, definition.cli);
  const repository = join(workspace, "repo");
  const configHome = join(workspace, "native-config");
  const installation = join(workspace, "installation");
  await mkdir(repository, { recursive: true, mode: 0o700 });
  await mkdir(configHome, { mode: 0o700 });
  const childEnv = {
    ...process.env,
    PATH: `${join(context.root, "packages/pi-extension/node_modules/.bin")}:${process.env.PATH ?? ""}`,
    AGENTCOMMONS_DIR: installation,
    AGENTCOMMONS_SERVER: publicUrl,
    AGENTCOMMONS_API_KEY: context.member.key,
    AGENTCOMMONS_DISABLE: "0",
  };
  const command = (name: string, args: string[], log: string) =>
    runNative(name, args, {
      cwd: repository,
      env: childEnv,
      log: join(workspace, log),
    });
  await command(definition.cli, ["--version"], "version.txt");
  const version = (
    await Promise.all(
      ["version.txt", "version.txt.stderr"].map((name) =>
        readFile(join(workspace, name), "utf8"),
      ),
    )
  ).join("");
  assert.ok(
    version.includes(definition.version),
    `${definition.cli} changed version; capture and review its contract first.`,
  );
  await initRepository({
    cwd: repository,
    env: childEnv,
    logDirectory: workspace,
    files: {
      "probe.txt": `AgentCommons observed git state ${definition.cli}.\n`,
    },
    message: "test: initialize live canary",
  });
  await writeFile(
    join(repository, "untracked-probe.txt"),
    "Observed uncommitted file.\n",
  );
  const installResponse = await fetch(`${publicUrl}/install.sh`);
  assert.equal(installResponse.status, 200);
  const installer = join(workspace, "install.sh");
  await writeFile(installer, await installResponse.text(), { mode: 0o700 });
  await command(
    "sh",
    [
      installer,
      "--server",
      publicUrl,
      "--key",
      context.member.key,
      "--config-home",
      configHome,
    ],
    "installer.txt",
  );
  // Self-update (R-CAP-16): the harness starts from a deliberately stale bundle and
  // extension. Its first uploader run must replace both with the served artifacts,
  // and every later upload must then report the served digest.
  const manifestResponse = await fetch(`${publicUrl}/hook/manifest.json`);
  assert.equal(manifestResponse.status, 200);
  const manifest = hookManifestSchema.parse(await manifestResponse.json());
  const stale = async (name: string) => {
    const path = join(installation, name);
    const bytes = Buffer.concat([
      await readFile(path),
      Buffer.from("\n// stale canary copy\n"),
    ]);
    await writeFile(path, bytes);
    return digest(bytes);
  };
  const staleBundle = await stale("hook.js");
  const staleExtension = await stale("pi-extension.mjs");
  // Make the installer's wiring record name the stale bundle, so the swap is a real
  // bundle change and the new bundle must re-run install (R-CAP-17), as after a server
  // deploy that adds a harness.
  const updatePath = join(installation, "update.json");
  const updateState = z
    .looseObject({ configured: z.looseObject({ sha256: z.string() }) })
    .parse(JSON.parse(await readFile(updatePath, "utf8")));
  updateState.configured.sha256 = staleBundle;
  await writeFile(updatePath, JSON.stringify(updateState));
  assert.notEqual(staleBundle, manifest.sha256);
  assert.notEqual(staleExtension, manifest.extensionSha256);
  const installationId = z
    .object({ installationId: z.uuid() })
    .parse(
      JSON.parse(await readFile(join(installation, "config.json"), "utf8")),
    ).installationId;
  const marker = `acprobe${context.runId}${definition.cli}`;
  const environment: CanaryEnvironment = {
    directory: workspace,
    repository,
    configHome,
    installation,
    marker,
    runId: context.runId,
    env: childEnv,
  };
  const completion = await definition.run(environment);
  const session = await waitUntil(
    async () => {
      const nativeComplete = await completedNativeSessions(
        database.prisma,
        organizationId,
        definition.harness,
        completion,
      );
      const candidates = rootSessionsWith(
        await nativeSessions(database, organizationId, definition.harness),
        marker,
      );
      assert.ok(
        candidates.length <= 1,
        `${definition.cli} created duplicate root sessions.`,
      );
      const candidate = candidates[0];
      const complete =
        candidate?.status === "ENDED" &&
        (!definition.resume || resumedMarker(candidate) !== undefined) &&
        candidate.messages.some((message) => message.kind === "TOOL_RESULT") &&
        candidate.messages.some((message) => message.kind === "TOOL_USE") &&
        (definition.delegationTool === null ||
          (candidate.messages.some(
            (message) =>
              message.kind === "TOOL_USE" &&
              message.tool_name === definition.delegationTool,
          ) &&
            candidate.messages.some(
              (message) =>
                message.kind === "TOOL_RESULT" &&
                message.tool_name === definition.delegationTool &&
                message.content.includes("Termination Reason: GOAL"),
            ))) &&
        candidate.messages.some(
          (message) => message.role === "ASSISTANT" && message.kind === "TEXT",
        ) &&
        (!definition.links ||
          candidate.children.some(
            (child) => child.parentRelation === definition.links,
          )) &&
        nativeComplete;
      return complete ? candidate : undefined;
    },
    {
      timeoutMs: 120_000,
      onTimeout: async () => {
        const incomplete = await database.prisma.traceSessionControl.findMany({
          where: { organizationId, harness: definition.harness },
        });
        context.report.harnesses.push({
          harness: definition.harness,
          failed: true,
          completion,
          diagnostics: incomplete.map((value) => ({
            session_id: value.id,
            native_session_id: value.harnessSessionId,
            status: value.status,
            parent_session_id: value.parentSessionId,
            lifecycle_pos: String(value.lifecyclePos),
            publication: value.projectionState,
            accepted_revision: String(value.acceptedRevision),
            published_revision: String(value.publishedRevision),
            projection_error: value.projectionError,
          })),
        });
        return new Error(
          `${definition.cli} did not ingest its complete session, tool result, end, and supported links; private state: ${installation}`,
        );
      },
    },
  );
  assert.ok(session.messages.some((message) => message.kind === "TOOL_USE"));
  assert.ok(
    session.messages.some(
      (message) => message.role === "ASSISTANT" && message.kind === "TEXT",
    ),
  );
  assert.ok(session.startCommit && session.endCommit);
  assert.equal(session.branch, "canary");
  const installedBundle = digest(await readFile(join(installation, "hook.js")));
  const installedExtension = digest(
    await readFile(join(installation, "pi-extension.mjs")),
  );
  assert.equal(
    installedBundle,
    manifest.sha256,
    `${definition.cli} hook did not update itself from the stale bundle; private state: ${installation}`,
  );
  assert.equal(
    installedExtension,
    manifest.extensionSha256,
    `${definition.cli} pi extension did not update itself; private state: ${installation}`,
  );
  const hookLog = await readFile(join(installation, "hook.log"), "utf8");
  assert.ok(hookLog.includes(`Updated to hook ${manifest.version}.`));
  assert.ok(!hookLog.includes("Hook update skipped"));
  // R-CAP-17: the swapped bundle re-ran install with the recorded flags.
  assert.ok(
    hookLog.includes(`with bundle ${manifest.sha256.slice(0, 12)}.`),
    `${definition.cli} did not reconfigure after the swap; private state: ${installation}`,
  );
  assert.ok(!hookLog.includes("Harness configuration skipped"));
  const installationRow = await database.prisma.installation.findUniqueOrThrow({
    where: { organizationId_id: { organizationId, id: installationId } },
  });
  assert.equal(
    installationRow.hookSha256,
    manifest.sha256,
    `${definition.cli} uploads after the swap did not report the served digest.`,
  );
  const installationsResponse = await fetch(
    `${publicUrl}/api/v1/installations?limit=100`,
    { headers: { authorization: `Bearer ${context.member.key}` } },
  );
  assert.equal(installationsResponse.status, 200);
  const listed = z
    .object({
      items: z.array(
        z.object({
          installation_id: z.uuid(),
          hook_sha256: z.string().nullable(),
        }),
      ),
    })
    .parse(await installationsResponse.json())
    .items.find((item) => item.installation_id === installationId);
  assert.equal(listed?.hook_sha256, manifest.sha256);
  assert.equal(session.repoName, "github.com/rek7/agentcommons");
  assert.ok(session.dirtyFileCount !== null && session.dirtyFileCount >= 1);
  assert.ok(session.observedDiffStat !== null);
  assert.ok(Array.isArray(session.observedCommits));
  const headers = {
    authorization: `Bearer ${context.readKey}`,
    "content-type": "application/json",
  };
  const searchResponse = await fetch(`${publicUrl}/api/v1/search`, {
    method: "POST",
    headers,
    body: JSON.stringify({ query: marker }),
  });
  assert.equal(searchResponse.status, 200);
  assert.ok(
    searchOutputSchema
      .parse(await searchResponse.json())
      .blocks.some((block) => block.session_id === session.id),
  );
  const getResponse = await fetch(
    `${publicUrl}/api/v1/sessions/${session.id}`,
    {
      headers,
    },
  );
  assert.equal(getResponse.status, 200);
  const get = getOutputSchema.parse(await getResponse.json());
  assert.ok(get.header);
  assert.equal(get.header.harness, definition.harness);
  assert.equal(get.header.end_commit, session.endCommit);
  const mcpSearch = await context.userClient.callTool({
    name: "search",
    arguments: { query: marker },
  });
  assert.notEqual(mcpSearch.isError, true);
  assert.ok(
    searchOutputSchema
      .parse(mcpSearch.structuredContent)
      .blocks.some((block) => block.session_id === session.id),
  );
  const mcpGet = await context.userClient.callTool({
    name: "get",
    arguments: { session_id: session.id },
  });
  assert.notEqual(mcpGet.isError, true);
  assert.deepEqual(
    getOutputSchema.parse(mcpGet.structuredContent).header,
    get.header,
  );
  const prompt = session.messages.find(
    (message) => message.role === "USER" && message.content.includes(marker),
  );
  const toolResult = session.messages.find(
    (message) =>
      message.kind === "TOOL_RESULT" &&
      message.content.includes("AgentCommons observed git state"),
  );
  assert.ok(prompt, "The native prompt must be persisted.");
  assert.ok(toolResult, "The real file read must be persisted.");
  // Dashboard: the prompt's deep link, Details with the id, the tool result,
  // the Reuse card. Each goto resets the page, so the tool switch is set per visit.
  await page.goto(`${publicUrl}${paths.session(session.id, prompt.seq)}`);
  const header = page.getByTestId("session-header");
  await header.waitFor({ timeout: 30_000 });
  await header
    .getByRole("button", { name: sessionsCopy.detail.details, exact: true })
    .click();
  await expect(
    page
      .locator("#session-details")
      .getByText(session.id, { exact: true })
      .first(),
  ).toBeVisible();
  const promptMessage = page.getByTestId(
    `session-message-${String(prompt.seq)}`,
  );
  await expect(promptMessage).toContainText(marker);
  await expect(promptMessage).toHaveClass(/border-accent/);
  // Following a message's own link keeps the deep-link shape in the address bar.
  await promptMessage
    .getByRole("link", {
      name: `${sessionsCopy.detail.transcript.message} ${String(prompt.seq)}`,
      exact: true,
    })
    .click();
  await expect(page).toHaveURL(
    `${publicUrl}${paths.session(session.id, prompt.seq)}`,
  );
  for (const heading of [
    sessionsCopy.detail.reuse.by,
    sessionsCopy.detail.reuse.from,
  ])
    await expect(
      page.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
  await page.goto(`${publicUrl}${paths.session(session.id, toolResult.seq)}`);
  const expandTools = page.getByRole("switch", {
    name: sessionsCopy.detail.transcript.expandTools,
    exact: true,
  });
  await expandTools.waitFor({ timeout: 30_000 });
  if ((await expandTools.getAttribute("aria-checked")) !== "true")
    await expandTools.click();
  // The collapsed summary and the output both quote the result; read the <pre>.
  await expect(
    page
      .getByTestId(`session-message-${String(toolResult.seq)}`)
      .locator("pre")
      .filter({ hasText: "AgentCommons observed git state" })
      .first(),
  ).toBeVisible();
  if (definition.resume) {
    const resumed = resumedMarker(session);
    assert.ok(
      resumed,
      "A native resumed session must retain its lifecycle marker.",
    );
    await page.goto(`${publicUrl}${paths.session(session.id, resumed.seq)}`);
    await page.getByTestId(`session-message-${String(resumed.seq)}`).waitFor();
  }
  await page.screenshot({
    path: join(context.output, `${definition.cli}-mobile.png`),
    fullPage: true,
  });
  const childTree = definition.links
    ? await verifyNativeTree({
        publicUrl,
        apiKey: context.readKey,
        client: context.userClient,
        page,
        parentId: session.id,
        relation: definition.links,
        spawningCall: definition.spawningCall,
        childIds: session.children
          .filter((child) => child.parentRelation === definition.links)
          .map((child) => child.id),
        probe: `AgentCommons observed git state ${definition.cli}.`,
        screenshotPath: join(
          context.output,
          `${definition.cli}-tree-mobile.png`,
        ),
      })
    : [];
  assert.deepEqual(browserErrors, []);
  context.report.harnesses.push({
    harness: definition.harness,
    version: version.trim(),
    session_id: session.id,
    native_session_id: session.harnessSessionId,
    ...(definition.delegationTool === null
      ? {}
      : { native_delegation_tool: definition.delegationTool }),
    message_count: session.messageCount,
    tool_call_count: session.toolCallCount,
    links: session.children.map((child) => ({
      session_id: child.id,
      relation: child.parentRelation,
    })),
    child_tree: childTree,
    start_commit: session.startCommit,
    end_commit: session.endCommit,
    dirty_file_count: session.dirtyFileCount,
    rest_search: true,
    rest_get: true,
    mcp_search: true,
    mcp_get: true,
    dashboard: true,
    dashboard_prompt: true,
    dashboard_tool_result: true,
    dashboard_resume: definition.resume,
    hook_update: {
      stale_sha256: staleBundle,
      stale_extension_sha256: staleExtension,
      served_version: manifest.version,
      served_sha256: manifest.sha256,
      installation_hook_sha256: installationRow.hookSha256,
    },
  });
  console.log(
    `${definition.cli}: uploaded, searched, read through MCP, visible in the mobile dashboard, and self-updated its hook to ${manifest.version}.`,
  );
  return { definition, environment, marker, sessionId: session.id };
}
