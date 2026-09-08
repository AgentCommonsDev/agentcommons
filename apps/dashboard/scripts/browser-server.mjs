import { waitForTracePublication } from "../../../packages/traces/test/support.ts";
import { TraceAuditProjectionService } from "../../api/src/services/trace-audit-projection.ts";
import {
  startTraceDatabase,
  traceEnvironment,
} from "../../../packages/traces/test/support.ts";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { writeFile, unlink, readFile } from "node:fs/promises";
import {
  provisionOrganization,
  provisionMember,
  testAuthConfiguration,
} from "../../api/test/support.ts";
import { createRuntime } from "../../api/src/main.ts";
import { createApp } from "../../api/src/app.ts";
import { startBrowserOidc } from "./browser-oidc.mjs";
import { environment } from "../../api/src/env.ts";

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
let runtime;
let app;
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
  const env = environment({
    ...traceEnvironment(database.traceConfig),
    PUBLIC_URL: publicUrl,
    DATABASE_URL: database.urls.app,
    BETTER_AUTH_SECRET: testAuthConfiguration.secret,
    LOG_LEVEL: "silent",
    TRUST_PROXY: "loopback",
    EMBEDDINGS_ENABLED: "true",
    EMBEDDINGS_PROVIDER: "fake",
  });
  runtime = await createRuntime(env);
  await runtime.jobs.start();
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
    const envelope = {
      envelopeVersion: 2,
      harness: "CLAUDE_CODE",
      harnessSessionId,
      behavior: "sync",
      nativeEvent: "Stop",
      batchId: randomUUID(),
      installationId,
      sentAt: new Date().toISOString(),
      sourcePos: records.length - 1,
      context: {
        cwd: "/repo",
        installation: {
          hostname: "browser-workstation",
          osUser: "developer",
          platform: "linux",
          arch: "x64",
        },
        git: {
          root: "/repo",
          remoteUrl: "git@github.com:rek7/agentcommons.git",
          branch: "browser-verification",
          head: "abc123",
        },
        parentHint: null,
      },
      records: records.map((record, pos) => ({
        pos,
        sourceVersion: 0,
        key: record.uuid,
        line: JSON.stringify(record),
      })),
      cursor: `${String(records.length)}:0`,
      end: null,
    };
    const result = await runtime.services.ingest.execute(
      index === 52 ? secondary.context : primary.context,
      envelope,
    );
    if (index === 0) liveEnvelope = envelope;
    sessionIds.push(result.result.sessionId);
  }
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
    foreignSessionId: sessionIds.at(-1),
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
  app = await createApp({
    env,
    services: runtime.services,
    ...(process.env.DASHBOARD_BROWSER_ASSETS
      ? { dashboardDirectory: process.env.DASHBOARD_BROWSER_ASSETS }
      : {}),
  });
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
  const searched = await app.inject({
    method: "POST",
    url: "/api/v1/search",
    headers: readerHeaders,
    payload: { query: "Dashboard verification" },
  });
  if (searched.statusCode !== 200)
    throw new Error(
      `Reuse fixture search failed: ${String(searched.statusCode)}`,
    );
  const read = await app.inject({
    method: "GET",
    url: `/api/v1/sessions/${sessionIds[0]}`,
    headers: readerHeaders,
  });
  if (read.statusCode !== 200)
    throw new Error(`Reuse fixture get failed: ${String(read.statusCode)}`);
  const emptySearch = await app.inject({
    method: "POST",
    url: "/api/v1/search",
    headers: readerHeaders,
    payload: {
      query: "missing-browser-reuse-evidence-7f9a",
      filters: { repo_name: "github.com/absent/browser-repo" },
    },
  });
  if (emptySearch.statusCode !== 200)
    throw new Error(
      `Reuse fixture empty search failed: ${String(emptySearch.statusCode)}`,
    );
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
  await new TraceAuditProjectionService({
    prisma: database.prisma,
    audit: database.audit,
    traces: database.traces,
  }).flush();
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
  await app?.close();
  await runtime?.close();
  await database.close();
  throw error;
}
async function close() {
  await closeOidc?.();
  await app?.close();
  await runtime?.close();
  await database.close();
  await unlink(statePath).catch(() => {});
}
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    void close().then(() => process.exit(0));
  });
