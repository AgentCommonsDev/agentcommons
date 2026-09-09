import assert from "node:assert/strict";
import { z } from "zod";
import { nativeToolPrompt, requiredNativeTools } from "../live-harnesses.js";
import type { CapturedHarness } from "./capture.js";
import {
  nativeSessions,
  plain,
  resultOf,
  rootSessionsWith,
  toolUses,
  waitUntil,
  type CanaryContext,
  type NativeSession,
} from "./support.js";

type RequiredTool = (typeof requiredNativeTools)[number];
const errorEnvelope = /"code"\s*:\s*"[A-Z_]+"\s*,\s*"message"\s*:/;
const auditActions: Record<RequiredTool, string> = {
  search: "search",
  get: "get",
  sql: "sql",
  dashboard_render: "dashboard.render",
};
const auditDetail = {
  call: z.object({
    input: z.object({ name: z.string() }).nullable(),
    code: z.string().optional(),
    message: z.string().optional(),
  }),
  protocol: z.object({ method: z.string() }),
};

/**
 * Native MCP usage: the harness runs a second hooked session that uses the registration
 * install.sh wrote (pi: the extension's tool bridge, ADR 0054) to search, read, query and
 * render through /mcp. The hook must capture that session, every required tool must
 * complete without an error, and the audit log must hold the matching rows for the
 * installed member key.
 */
export async function nativeToolStage(
  context: CanaryContext,
  { definition, environment, sessionId }: CapturedHarness,
) {
  const { database, organizationId } = context;
  console.log(`Running ${definition.cli} native MCP tool stage.`);
  const stage = {
    ...environment,
    marker: `acmcp${context.runId}${definition.cli}`,
    query: environment.marker,
  };
  const prompt = nativeToolPrompt(stage, definition.mcpTool);
  const names = Object.fromEntries(
    requiredNativeTools.map((tool) => [tool, definition.mcpTool(tool)]),
  ) as Record<RequiredTool, string>;
  const stageStart = new Date();
  const partial = (extra: Record<string, unknown>) => ({
    harness: definition.harness,
    supported: true,
    passed: false,
    prompt,
    tool_names: names,
    ...extra,
  });
  try {
    await definition.tools(stage);
  } catch (error) {
    context.report.native_tools.push(
      partial({
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    throw error;
  }
  let latest: NativeSession | undefined;
  const toolSession = await waitUntil(
    async () => {
      const candidates = rootSessionsWith(
        await nativeSessions(database, organizationId, definition.harness),
        stage.marker,
      );
      assert.ok(
        candidates.length <= 1,
        `${definition.cli} created duplicate native MCP tool sessions.`,
      );
      const candidate = candidates[0];
      latest = candidate;
      const completed = (name: string) =>
        candidate?.messages.some(
          (use) =>
            use.kind === "TOOL_USE" &&
            use.tool_name === name &&
            resultOf(candidate, use) !== undefined,
        ) ?? false;
      return candidate?.status === "ENDED" &&
        requiredNativeTools.every((tool) => completed(names[tool])) &&
        candidate.messages.some(
          (message) => message.role === "ASSISTANT" && message.kind === "TEXT",
        )
        ? candidate
        : undefined;
    },
    {
      timeoutMs: 120_000,
      onTimeout: () => {
        context.report.native_tools.push(
          partial({
            session_id: latest?.id ?? null,
            status: latest?.status ?? null,
            invoked:
              latest?.messages
                .filter((message) => message.kind === "TOOL_USE")
                .map((message) => message.tool_name) ?? [],
          }),
        );
        return new Error(
          `${definition.cli} did not ingest a complete native MCP tool session; private state: ${environment.installation}`,
        );
      },
    },
  );
  const uses = toolUses(toolSession);
  const mcpUses = uses.filter((use) =>
    use.tool_name?.startsWith(definition.mcpTool("")),
  );
  // The catalog must load eagerly: the first AgentCommons call is direct, not behind
  // the harness's deferred-tool loader (Claude Code ToolSearch, R-MCP-09).
  const deferredAt =
    definition.deferralTool === null
      ? -1
      : uses.findIndex((use) => use.tool_name === definition.deferralTool);
  const firstMcpAt = uses.findIndex((use) =>
    use.tool_name?.startsWith(definition.mcpTool("")),
  );
  const deferred = deferredAt !== -1 && deferredAt < firstMcpAt;
  const toolErrors = mcpUses.flatMap((use) => {
    const result = resultOf(toolSession, use);
    const content = plain(result?.content ?? "");
    return !result ||
      errorEnvelope.test(content) ||
      content.includes("requires approval")
      ? [
          {
            tool_name: use.tool_name,
            input: use.tool_input,
            result: content.slice(0, 400) || null,
          },
        ]
      : [];
  });
  const required = Object.fromEntries(
    requiredNativeTools.map((tool) => {
      const use = uses.find((message) => message.tool_name === names[tool]);
      assert.ok(use, `${definition.cli} never called ${names[tool]}.`);
      const result = resultOf(toolSession, use);
      assert.ok(result, `${definition.cli} has no result for ${names[tool]}.`);
      return [
        tool,
        {
          input: z.record(z.string(), z.unknown()).parse(use.tool_input),
          content: result.content,
        },
      ];
    }),
  ) as Record<
    RequiredTool,
    { input: Record<string, unknown>; content: string }
  >;
  // search found the earlier capture session for the marker the user gave.
  assert.ok(
    String(required.search.input.query).includes(environment.marker),
    `${definition.cli} searched for something other than the marker.`,
  );
  assert.ok(
    required.search.content.includes(sessionId),
    `${definition.cli} search did not return the capture session.`,
  );
  // get used an id from the search result, and the result carried that session.
  const readId = z.uuid().parse(required.get.input.session_id);
  assert.ok(
    required.search.content.includes(readId),
    `${definition.cli} read a session id the search did not return.`,
  );
  assert.ok(
    required.get.content.includes(readId),
    `${definition.cli} get did not return the requested session.`,
  );
  // sql ran over api_ro views and saw this harness's own sessions.
  assert.ok(
    required.sql.content.includes(definition.harness),
    `${definition.cli} sql result lacks its own harness row.`,
  );
  // dashboard_render returned rendered tiles without a tile error.
  const rendered = plain(required.dashboard_render.content);
  assert.ok(
    rendered.includes('"rendered_at"') &&
      rendered.includes('"tiles"') &&
      !/"error"\s*:\s*\{/.test(rendered),
    `${definition.cli} dashboard_render returned no clean tile rows.`,
  );
  const auditRows = await database.prisma.auditEvent.findMany({
    where: {
      organizationId,
      apiKeyId: z.string().parse(context.member.context.caller?.apiKeyId),
      transport: "mcp",
      ts: { gte: stageStart },
    },
    orderBy: { ts: "asc" },
    select: { action: true, statusCode: true, detail: true, ts: true },
  });
  const auditCalls = auditRows.map((row) => ({
    action: row.action,
    status_code: row.statusCode,
    ...(row.action === "mcp.call"
      ? { detail: auditDetail.call.parse(row.detail) }
      : {}),
    ...(row.action === "mcp.protocol"
      ? { method: auditDetail.protocol.parse(row.detail).method }
      : {}),
  }));
  // Tool and catalog failures are the harness misusing the server, or the server
  // rejecting a real call. Protocol rows are the client's connection negotiation
  // (Claude Code probes `server/discover` with a newer protocol version first); they
  // are recorded, and must all precede the catalog listing.
  const auditErrors = auditCalls.filter(
    (row) => row.action !== "mcp.protocol" && row.status_code >= 400,
  );
  const listedAt = auditRows.find(
    (row) => row.action === "mcp.tools.list" && row.statusCode < 400,
  )?.ts;
  const protocolRejections = auditRows
    .filter((row) => row.action === "mcp.protocol" && row.statusCode >= 400)
    .map((row) => ({
      method: auditDetail.protocol.parse(row.detail).method,
      status_code: row.statusCode,
      before_catalog: listedAt !== undefined && row.ts < listedAt,
    }));
  assert.ok(
    protocolRejections.every((row) => row.before_catalog),
    `${definition.cli}: an MCP protocol rejection happened after the catalog was listed; see native_tools in the report.`,
  );
  for (const tool of requiredNativeTools)
    assert.ok(
      auditCalls.some(
        (row) => row.action === auditActions[tool] && row.status_code < 400,
      ),
      `${definition.cli}: the audit log has no successful ${auditActions[tool]} row over MCP.`,
    );
  assert.ok(
    auditCalls.some(
      (row) => row.action === "mcp.tools.list" && row.status_code < 400,
    ),
    `${definition.cli} never listed the MCP catalog through the installed registration.`,
  );
  context.report.native_tools.push({
    harness: definition.harness,
    supported: true,
    passed: toolErrors.length === 0 && auditErrors.length === 0,
    prompt,
    session_id: toolSession.id,
    native_session_id: toolSession.harnessSessionId,
    tool_names: names,
    invoked: uses.map((use) => use.tool_name),
    deferred_by_tool_loader: deferred,
    read_session_id: readId,
    tool_errors: toolErrors,
    audit_calls: auditCalls,
    audit_errors: auditErrors,
    protocol_rejections: protocolRejections,
  });
  assert.deepEqual(
    toolErrors,
    [],
    `${definition.cli} native MCP tool calls returned errors; see native_tools in the report.`,
  );
  assert.deepEqual(
    auditErrors,
    [],
    `${definition.cli} MCP requests were rejected by the server; see native_tools in the report.`,
  );
  assert.ok(
    !deferred,
    `${definition.cli} loaded the AgentCommons tools through its deferred-tool loader; the catalog is too large to load eagerly.`,
  );
  console.log(
    `${definition.cli}: natively completed ${String(mcpUses.length)} AgentCommons MCP calls in a hooked session.`,
  );
}
