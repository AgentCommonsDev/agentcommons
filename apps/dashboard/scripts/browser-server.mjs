import {
  startTraceDatabase,
  waitForTracePublication,
} from "../../../packages/traces/test/support.ts";
import { TraceAuditProjectionService } from "../../api/src/services/trace-audit-projection.ts";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { writeFile, unlink, readFile } from "node:fs/promises";
import {
  provisionOrganization,
  provisionMember,
  testAuthConfiguration,
} from "../../api/test/support.ts";
import { startApp } from "../../api/test/app.ts";
import { testEnvelope } from "../../api/test/envelopes.ts";
import { startBrowserOidc } from "./browser-oidc.mjs";

const browserCookies = (cookie) =>
  cookie.split("; ").map((entry) => {
    const equal = entry.indexOf("=");
    return {
      name: entry.slice(0, equal),
      value: entry.slice(equal + 1),
      domain: "localhost",
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    };
  });

// Dedicated, disposable real database. This process never connects to the developer's .env.
const basePort = z.coerce
  .number()
  .int()
  .min(1024)
  .max(65532)
  .parse(process.env.DASHBOARD_BROWSER_PORT ?? 3000);
const publicUrl = `http://localhost:${String(basePort)}`;
const authConfiguration = { ...testAuthConfiguration, publicUrl };
const database = await startTraceDatabase(authConfiguration);
let server;
let closeOidc;
const statePath =
  process.env.DASHBOARD_BROWSER_STATE ??
  "/tmp/agentcommons-dashboard-browser-state.json";
try {
  const primary = await provisionOrganization(database, "browser-primary");
  const secondary = await provisionOrganization(database, "browser-secondary");
  await database.prisma.organizationSettings.create({
    data: {
      organizationId: z.string().parse(primary.owner.caller?.organizationId),
      embeddingsEnabled: true,
    },
  });
  // The server listens only once the fixture below is seeded (see the end of this block).
  server = await startApp(
    database,
    {
      PUBLIC_URL: publicUrl,
      TRUST_PROXY: "loopback",
      // The fixture defines its own instance settings: the suites and their visual baselines
      // assume embeddings surfaces exist, whatever the ambient CI matrix sets. Specs that
      // cover the disabled state flip the organization toggle instead.
      EMBEDDINGS_ENABLED: "true",
      EMBEDDINGS_PROVIDER: "fake",
    },
    {
      jobs: true,
      // Every spec reads as the same owner, so the whole suite shares one 300/min read
      // budget (§9.4) that a few session pages in a row exhaust, and a refused events
      // stream then shows Reconnecting. The fixture is many users' traffic, not one user's.
      rateMaxima: { read: 3000 },
      ...(process.env.DASHBOARD_BROWSER_ASSETS
        ? { dashboardDirectory: process.env.DASHBOARD_BROWSER_ASSETS }
        : { static: true }),
    },
  );
  const { runtime, app } = server;
  await runtime.services.members.add(secondary.owner, {
    emails: [primary.email],
    role: "member",
  });
  const setup = await runtime.services.members.add(primary.owner, {
    emails: ["browser-setup@example.com"],
    role: "member",
  });
  const installationId = randomUUID();
  const sessionIds = [];
  let liveEnvelope;
  let treeEnvelope;
  for (let index = 0; index < 53; index++) {
    const harnessSessionId = randomUUID();
    const text =
      index === 0
        ? "Dashboard verification: inspect the transaction boundary and preserve session history."
        : `Browser pagination session ${String(index)}`;
    const records = [
      {
        type: "user",
        uuid: `user-${String(index)}`,
        timestamp: new Date().toISOString(),
        message: { content: [{ type: "text", text }] },
      },
    ];
    if (index === 0)
      records.push(
        {
          type: "assistant",
          uuid: "assistant-main",
          timestamp: new Date().toISOString(),
          message: {
            model: "captured-browser-model",
            content: [
              {
                type: "thinking",
                thinking:
                  "Check the transaction before changing the upload cursor.",
              },
              {
                type: "text",
                text: "The upload acknowledges a committed batch.\n\n```ts\nconst acknowledged = await upload(batch);\n```",
              },
              {
                type: "tool_use",
                id: "tool-browser",
                name: "Read",
                input: { file_path: "/repo/src/upload.ts" },
              },
            ],
          },
        },
        {
          type: "user",
          uuid: "result-main",
          timestamp: new Date().toISOString(),
          message: {
            content: [
              {
                type: "tool_result",
                tool_use_id: "tool-browser",
                content:
                  "export async function upload(batch) { return persist(batch); }",
              },
            ],
          },
        },
      );
    if (index === 0)
      records.push({
        type: "future_record",
        uuid: "oversized-browser",
        text: "Long raw record browser verification. ".repeat(4000),
      });
    const envelope = testEnvelope({
      harnessSessionId,
      installationId,
      sourcePos: records.length - 1,
      cursor: `${String(records.length)}:0`,
      context: {
        installation: { hostname: "browser-workstation" },
        git: {
          root: "/repo",
          remoteUrl: "git@github.com:rek7/agentcommons.git",
          branch: "browser-verification",
          head: "abc123",
        },
      },
      records: records.map((record, pos) => ({
        pos,
        sourceVersion: 0,
        key: record.uuid,
        line: JSON.stringify(record),
      })),
    });
    const result = await runtime.services.ingest.execute(
      index === 52 ? secondary.context : primary.context,
      envelope,
    );
    if (index === 0) liveEnvelope = envelope;
    if (index === 1) treeEnvelope = envelope;
    sessionIds.push(result.result.sessionId);
  }
  // A subagent run under the first session, so the session page can show child runs inline.
  if (!liveEnvelope) throw new Error("Expected the seeded transcript.");
  const childHarnessSessionId = randomUUID();
  const childEnvelope = (behavior, nativeEvent, records, extra) => ({
    ...liveEnvelope,
    harnessSessionId: childHarnessSessionId,
    batchId: randomUUID(),
    behavior,
    nativeEvent,
    sentAt: new Date().toISOString(),
    sourcePos: Math.max(0, records.length - 1),
    records: records.map((record, pos) => ({
      pos,
      sourceVersion: 0,
      key: record.uuid,
      line: JSON.stringify(record),
    })),
    cursor: `${String(records.length)}:0`,
    context: {
      ...liveEnvelope.context,
      parentHint: {
        harnessSessionId: liveEnvelope.harnessSessionId,
        relation: "SUBAGENT",
        agentType: "Explore",
      },
    },
    ...extra,
  });
  await runtime.services.ingest.execute(
    primary.context,
    childEnvelope("start", "SubagentStart", [], { start: { resume: false } }),
  );
  const childResult = await runtime.services.ingest.execute(
    primary.context,
    childEnvelope(
      "end",
      "SubagentStop",
      [
        {
          type: "user",
          uuid: "child-user",
          timestamp: new Date().toISOString(),
          message: {
            content: [
              {
                type: "text",
                text: "Subagent task: read /repo/src/upload.ts and report its exports.",
              },
            ],
          },
        },
        {
          type: "assistant",
          uuid: "child-assistant",
          timestamp: new Date().toISOString(),
          message: {
            model: "captured-browser-model",
            content: [
              {
                type: "tool_use",
                id: "tool-child",
                name: "Read",
                input: { file_path: "/repo/src/upload.ts" },
              },
            ],
          },
        },
        {
          type: "user",
          uuid: "child-result",
          timestamp: new Date().toISOString(),
          message: {
            content: [
              {
                type: "tool_result",
                tool_use_id: "tool-child",
                content:
                  "export async function upload(batch) { return persist(batch); }",
              },
            ],
          },
        },
        {
          type: "assistant",
          uuid: "child-final",
          timestamp: new Date().toISOString(),
          message: {
            model: "captured-browser-model",
            content: [
              {
                type: "text",
                text: "The module exports one function: upload(batch).",
              },
            ],
          },
        },
      ],
      { end: null },
    ),
  );
  sessionIds.push(childResult.result.sessionId);
  // A second root whose Agent result names the child it spawned, so the transcript can
  // nest that run under the call. The child uploads first, as SubagentStart fires before
  // the parent's result record exists; the parent's evidence resolves the link later.
  if (!treeEnvelope) throw new Error("Expected the second seeded transcript.");
  const treeAgentId = "browsertreeagent01";
  const treeChildHarnessSessionId = `${treeEnvelope.harnessSessionId}:agent-${treeAgentId}`;
  const treeRecord = (record) => ({
    ...record,
    sessionId: treeEnvelope.harnessSessionId,
    timestamp: new Date().toISOString(),
  });
  const treeBatch = (harnessSessionId, records, firstPos, extra) => ({
    ...treeEnvelope,
    harnessSessionId,
    batchId: randomUUID(),
    sentAt: new Date().toISOString(),
    sourcePos: firstPos + records.length - 1,
    records: records.map((record, index) => ({
      pos: firstPos + index,
      sourceVersion: 0,
      key: record.uuid,
      line: JSON.stringify(record),
    })),
    cursor: `${String(firstPos + records.length)}:0`,
    ...extra,
  });
  const treeChildResult = await runtime.services.ingest.execute(
    primary.context,
    treeBatch(
      treeChildHarnessSessionId,
      [
        treeRecord({
          type: "user",
          uuid: "tree-child-user",
          isSidechain: true,
          agentId: treeAgentId,
          message: {
            content: [
              {
                type: "text",
                text: "Nested subagent task: list the exports of /repo/src/upload.ts.",
              },
            ],
          },
        }),
        treeRecord({
          type: "assistant",
          uuid: "tree-child-final",
          isSidechain: true,
          agentId: treeAgentId,
          message: {
            model: "captured-browser-model",
            content: [
              {
                type: "text",
                text: "Nested subagent answer: the module exports upload(batch).",
              },
            ],
          },
        }),
      ],
      0,
      {
        behavior: "end",
        nativeEvent: "SubagentStop",
        context: {
          ...treeEnvelope.context,
          parentHint: {
            harnessSessionId: treeEnvelope.harnessSessionId,
            relation: "SUBAGENT",
            agentType: "Explore",
          },
        },
      },
    ),
  );
  sessionIds.push(treeChildResult.result.sessionId);
  await runtime.services.ingest.execute(
    primary.context,
    treeBatch(
      treeEnvelope.harnessSessionId,
      [
        treeRecord({
          type: "assistant",
          uuid: "tree-agent-call",
          message: {
            model: "captured-browser-model",
            content: [
              {
                type: "tool_use",
                id: "tool-tree-agent",
                name: "Agent",
                input: {
                  subagent_type: "Explore",
                  description: "List the upload exports",
                  prompt: "List the exports of /repo/src/upload.ts.",
                },
              },
            ],
          },
        }),
        treeRecord({
          type: "user",
          uuid: "tree-agent-result",
          message: {
            content: [
              {
                type: "tool_result",
                tool_use_id: "tool-tree-agent",
                content:
                  "Nested subagent answer: the module exports upload(batch).",
              },
            ],
          },
          toolUseResult: { agentId: treeAgentId, agentType: "Explore" },
        }),
      ],
      1,
      {},
    ),
  );
  // Visual comparisons use their own real organization so functional mutations
  // cannot alter the baseline dataset between viewport projects.
  const visual = await provisionOrganization(database, "browser-visual");
  await database.prisma.organizationSettings.create({
    data: {
      organizationId: z.string().parse(visual.owner.caller?.organizationId),
      embeddingsEnabled: true,
    },
  });
  const visualSetup = await runtime.services.members.add(visual.owner, {
    emails: ["visual-invite@example.com"],
    role: "member",
  });
  const visualIds = [];
  const visualMonday = new Date();
  visualMonday.setUTCHours(0, 0, 0, 0);
  visualMonday.setUTCDate(
    visualMonday.getUTCDate() - ((visualMonday.getUTCDay() + 6) % 7),
  );
  const visualTimeShiftMs =
    visualMonday.getTime() - Date.parse("2026-09-07T00:00:00.000Z");
  const visualDate = (milliseconds) =>
    new Date(visualMonday.getTime() + milliseconds).toISOString();
  if (!liveEnvelope) throw new Error("Expected the seeded transcript.");
  for (let index = 0; index < 3; index++) {
    const timestamp = visualDate(index);
    const records = liveEnvelope.records.map((record, position) => {
      const payload = JSON.parse(record.line);
      payload.timestamp = timestamp;
      if (position === 0)
        payload.message.content[0].text = `Visual comparison session ${String(index + 1)}: inspect the upload transaction.`;
      return { ...record, line: JSON.stringify(payload) };
    });
    const result = await runtime.services.ingest.execute(visual.context, {
      ...liveEnvelope,
      harnessSessionId: randomUUID(),
      installationId: randomUUID(),
      batchId: randomUUID(),
      behavior: "end",
      nativeEvent: "SessionEnd",
      sentAt: visualDate(10),
      records,
    });
    visualIds.push(result.result.sessionId);
  }
  const visualMembers = await database.prisma.member.findMany({
    where: { organizationId: visual.owner.caller?.organizationId },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  for (const [index, member] of visualMembers.entries())
    await database.prisma.member.update({
      where: { id: member.id },
      data: {
        createdAt: new Date(visualDate(index)),
      },
    });
  const visualCookie = visual.owner.headers.get("cookie");
  if (!visualCookie) throw new Error("Expected the visual owner session.");
  const cookie = primary.owner.headers.get("cookie");
  if (!cookie) throw new Error("Native owner cookie was not provisioned");
  const cookies = browserCookies(cookie);
  const browserState = {
    storageState: { cookies, origins: [] },
    visual: {
      storageState: {
        cookies: browserCookies(visualCookie),
        origins: [],
      },
      sessionId: visualIds[0],
      timeShiftMs: visualTimeShiftMs,
      setupUrl: visualSetup.result.results[0]?.setup_url,
    },
    ingestKey: primary.key,
    liveEnvelope,
    sessionId: sessionIds[0],
    childSessionId: childResult.result.sessionId,
    treeSessionId: sessionIds[1],
    treeChildSessionId: treeChildResult.result.sessionId,
    foreignSessionId: sessionIds[52],
    organizationId: primary.owner.caller?.organizationId,
    secondaryOrganizationId: secondary.owner.caller?.organizationId,
    ownerEmail: primary.email,
    setupUrl: setup.result.results[0]?.setup_url,
  };
  // The real worker takes one batch per poll; 56 independent sessions can
  // legitimately need more than a minute on a shared CI machine.
  await waitForTracePublication(
    database.prisma,
    [...sessionIds, ...visualIds],
    {
      timeoutMs: 120_000,
    },
  );
  closeOidc = await startBrowserOidc(
    database,
    runtime.services,
    primary.owner,
    basePort,
  );
  const reader = await provisionMember(
    database,
    primary.owner,
    "browser-reader@example.com",
  );
  const reuseInstallationId = randomUUID();
  const reuseEnvelope = {
    ...liveEnvelope,
    harnessSessionId: randomUUID(),
    installationId: reuseInstallationId,
    batchId: randomUUID(),
    sentAt: new Date().toISOString(),
    context: {
      ...liveEnvelope.context,
      installation: {
        ...liveEnvelope.context.installation,
        hostname: "reuse-workstation",
      },
    },
    records: [
      {
        pos: 0,
        sourceVersion: 0,
        key: "reuse-reader-prompt",
        line: JSON.stringify({
          type: "user",
          uuid: "reuse-reader-prompt",
          timestamp: new Date().toISOString(),
          message: {
            content: [
              {
                type: "text",
                text: "Read the earlier upload transaction decision before updating the same file.",
              },
            ],
          },
        }),
      },
    ],
    sourcePos: 0,
    cursor: "1:0",
  };
  const readerHeaders = { authorization: `Bearer ${reader.key}` };
  const captured = await app.inject({
    method: "POST",
    url: "/api/v1/ingest",
    headers: readerHeaders,
    payload: reuseEnvelope,
  });
  if (captured.statusCode !== 202)
    throw new Error(
      `Reuse fixture ingest failed: ${String(captured.statusCode)}`,
    );
  const reuseSessionId = z
    .object({ sessionId: z.uuid() })
    .parse(captured.json()).sessionId;
  await waitForTracePublication(database.prisma, [reuseSessionId]);
  // Only MCP reads after the key's `tools/list` on its installation are agent reuse
  // (ADR 0060), so the reader works as a harness does: handshake, then search and get.
  let rpcId = 0;
  const mcp = async (method, params) => {
    const notification = method.startsWith("notifications/");
    const response = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        ...readerHeaders,
        accept: "application/json, text/event-stream",
      },
      payload: {
        jsonrpc: "2.0",
        method,
        ...(notification ? {} : { id: (rpcId += 1) }),
        ...(params === undefined ? {} : { params }),
      },
    });
    const failed = () =>
      new Error(
        `Reuse fixture ${method} failed: ${String(response.statusCode)} ${response.body}`,
      );
    if (response.statusCode !== (notification ? 202 : 200)) throw failed();
    if (notification) return;
    // A tool failure is a 200 whose result says isError; a protocol failure has no result.
    const answer = z
      .object({ result: z.looseObject({ isError: z.boolean().optional() }) })
      .safeParse(response.json());
    if (!answer.success || answer.data.result.isError === true) throw failed();
  };
  await mcp("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "browser-reuse-reader", version: "1" },
  });
  await mcp("notifications/initialized");
  await mcp("tools/list");
  await mcp("tools/call", {
    name: "search",
    arguments: { query: "Dashboard verification" },
  });
  await mcp("tools/call", {
    name: "get",
    arguments: { session_id: sessionIds[0] },
  });
  await mcp("tools/call", {
    name: "search",
    arguments: {
      query: "missing-browser-reuse-evidence-7f9a",
      filters: { repo_name: "github.com/absent/browser-repo" },
    },
  });
  const ownerEmptySearch = await app.inject({
    method: "POST",
    url: "/api/v1/search",
    headers: { authorization: `Bearer ${primary.key}` },
    payload: {
      query: "missing-owner-only-browser-evidence-8c2f",
      filters: { repo_name: "github.com/absent/browser-repo" },
    },
  });
  if (ownerEmptySearch.statusCode !== 200)
    throw new Error(
      `Owner zero-result fixture failed: ${String(ownerEmptySearch.statusCode)}`,
    );
  const ended = await app.inject({
    method: "POST",
    url: "/api/v1/ingest",
    headers: readerHeaders,
    payload: {
      ...reuseEnvelope,
      records: [],
      batchId: randomUUID(),
      behavior: "end",
      nativeEvent: "SessionEnd",
      sentAt: new Date().toISOString(),
    },
  });
  if (ended.statusCode !== 202)
    throw new Error(`Reuse fixture end failed: ${String(ended.statusCode)}`);
  const readerCookie = reader.owner.headers.get("cookie");
  if (!readerCookie) throw new Error("Expected the reuse member session.");
  const adoption = await provisionOrganization(database, "browser-adoption");
  const adoptionMember = await provisionMember(
    database,
    adoption.owner,
    "browser-adoption-member@example.com",
  );
  const emptyAdoption = await provisionOrganization(
    database,
    "browser-adoption-empty",
  );
  await runtime.services.members.add(emptyAdoption.owner, {
    emails: [adoption.email],
    role: "member",
  });
  const capturedSearch = (
    await readFile(
      new URL(
        "../../../fixtures/transcripts/tool-identities/claude.jsonl",
        import.meta.url,
      ),
      "utf8",
    )
  )
    .trimEnd()
    .split("\n")
    .map((line, pos) => {
      const payload = JSON.parse(line);
      payload.timestamp = visualDate(0);
      return {
        pos,
        sourceVersion: 0,
        key: payload.uuid ?? `captured-search-${String(pos)}`,
        line: JSON.stringify(payload),
      };
    });
  for (const visibility of ["PUBLIC", "PRIVATE"]) {
    const captured = await runtime.services.ingest.execute(adoption.context, {
      ...liveEnvelope,
      harnessSessionId: randomUUID(),
      installationId: randomUUID(),
      batchId: randomUUID(),
      behavior: "end",
      nativeEvent: "SessionEnd",
      sentAt: visualDate(10),
      records: capturedSearch,
      sourcePos: capturedSearch.length - 1,
      cursor: `${String(capturedSearch.length)}:0`,
      context: {
        ...liveEnvelope.context,
        git: {
          ...liveEnvelope.context.git,
          remoteUrl: "https://github.com/fixture/search-adoption",
        },
      },
    });
    await waitForTracePublication(database.prisma, [captured.result.sessionId]);
    if (visibility === "PRIVATE")
      await runtime.services.admin.setVisibility(adoption.owner, {
        session_id: captured.result.sessionId,
        visibility,
        reason: "Verify member-visible transcript adoption counts",
      });
  }
  const adoptionCookie = adoption.owner.headers.get("cookie");
  const adoptionMemberCookie = adoptionMember.owner.headers.get("cookie");
  if (!adoptionCookie || !adoptionMemberCookie)
    throw new Error("Expected native adoption fixture sessions.");
  const embeddingControl = await provisionOrganization(
    database,
    "browser-embedding-control",
  );
  const embeddingEnvelope = {
    ...liveEnvelope,
    harnessSessionId: randomUUID(),
    batchId: randomUUID(),
    installationId: randomUUID(),
  };
  const embeddingAccepted = await runtime.services.ingest.execute(
    embeddingControl.context,
    embeddingEnvelope,
  );
  await waitForTracePublication(database.prisma, [
    embeddingAccepted.result.sessionId,
  ]);
  // Reuse and search adoption read the projected, attributed audit rows. Drain the whole
  // outbox before serving: one batch can stop short of the reader's calls, which would
  // then wait for the worker's once-a-minute run while the first specs look for them.
  const auditProjection = new TraceAuditProjectionService({
    prisma: database.prisma,
    audit: database.audit,
    traces: database.traces,
    readers: database.traceReaders,
  });
  while (await auditProjection.flush()) {
    /* Until the outbox is empty. */
  }
  const embeddingCookie = z
    .string()
    .parse(embeddingControl.owner.headers.get("cookie"));
  await writeFile(
    statePath,
    JSON.stringify({
      ...browserState,
      embeddings: {
        organizationId: embeddingControl.owner.caller?.organizationId,
        storageState: { cookies: browserCookies(embeddingCookie), origins: [] },
      },
      adoption: {
        organizationId: adoption.owner.caller?.organizationId,
        emptyOrganizationId: emptyAdoption.owner.caller?.organizationId,
        ownerStorageState: {
          cookies: browserCookies(adoptionCookie),
          origins: [],
        },
        memberStorageState: {
          cookies: browserCookies(adoptionMemberCookie),
          origins: [],
        },
      },
      reuse: {
        sourceSessionId: reuseSessionId,
        targetSessionId: sessionIds[0],
        installationId: reuseInstallationId,
        userEmail: reader.email,
        readerUserId: reader.owner.caller?.userId,
        storageState: { cookies: browserCookies(readerCookie), origins: [] },
      },
    }),
    { mode: 0o600 },
  );
  await app.listen({ port: basePort, host: "127.0.0.1" });
  process.stdout.write(`Dashboard browser server ready at ${publicUrl}\n`);
} catch (error) {
  await closeOidc?.();
  await server?.close();
  await database.close();
  throw error;
}
async function close() {
  await closeOidc?.();
  await server?.close();
  await database.close();
  await unlink(statePath).catch(() => {});
}
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    void close().then(() => process.exit(0));
  });
