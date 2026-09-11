import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { z } from "zod";
import { startMailpit } from "../apps/api/test/mailpit.js";
import {
  provisionMember,
  provisionOrganization,
  testAuthConfiguration,
} from "../apps/api/test/support.js";
import { startTraceDatabase } from "../packages/traces/test/support.js";
import { verifyCanaryEmail } from "./canary-auth.js";
import { agentMcpCheck } from "./canary/agent-check.js";
import {
  assertCatalogWithinBudget,
  connectMcp,
  measureCatalog,
  mobilePage,
  snapshotDashboard,
  startApi,
} from "./canary/boot.js";
import { captureHarness, type CapturedHarness } from "./canary/capture.js";
import { keepRunning, type CanaryHandles } from "./canary/keep-alive.js";
import { nativeToolStage } from "./canary/native-tools.js";
import { organicRecallStage } from "./canary/recall.js";
import { writeReport } from "./canary/report.js";
import type { CanaryContext, CanaryReport } from "./canary/support.js";
import { cleanup } from "./cleanup.js";
import { liveHarnesses } from "./live-harnesses.js";

/**
 * The live harness canary: boots a disposable API, drives every selected native harness
 * through its installed hook (scripts/canary/capture.ts), lets a separate agent find the
 * sessions over MCP (agent-check.ts), then has each harness use the AgentCommons tools
 * natively (native-tools.ts) and recall a decision unprompted (recall.ts). The report
 * goes to CANARY_OUTPUT whether the run passed or failed.
 */
const root = fileURLToPath(new URL("../", import.meta.url));
const settings = z
  .object({
    CANARY_PORT: z.coerce.number().int().min(1024).max(65535).default(3200),
    CANARY_OUTPUT: z
      .string()
      .default(resolve(root, "test-results/live-canary")),
    GEMINI_API_KEY: z.string().min(1),
    CANARY_INSTANCE_MODE: z.enum(["customer", "saas"]).default("customer"),
    CANARY_KEEP_RUNNING: z
      .enum(["false", "true"])
      .default("false")
      .transform((value) => value === "true"),
  })
  .parse(process.env);
/** CANARY_HARNESSES=claude,codex limits a run to some CLIs; the default runs all four. */
const selectedHarnesses = liveHarnesses.filter(
  (definition) =>
    !process.env.CANARY_HARNESSES ||
    process.env.CANARY_HARNESSES.split(",")
      .map((name) => name.trim())
      .includes(definition.cli),
);
if (selectedHarnesses.length === 0)
  throw new Error("CANARY_HARNESSES selected no known harness CLI.");
const runId = randomBytes(8).toString("hex");
const directory = await mkdtemp(join(tmpdir(), "agentcommons-live-canary-"));
await chmod(directory, 0o700);
await mkdir(settings.CANARY_OUTPUT, { recursive: true });
const publicUrl = `http://localhost:${String(settings.CANARY_PORT)}`;
const assets = await snapshotDashboard(root, directory);
const database = await startTraceDatabase({
  ...testAuthConfiguration,
  publicUrl,
});
const handles: CanaryHandles = {
  runtime: undefined,
  app: undefined,
  browser: undefined,
  mail: undefined,
  clients: [],
};
const report: CanaryReport = {
  harnesses: [],
  native_tools: [],
  organic_recall: [],
  catalog: null,
};
try {
  const administrator = await provisionOrganization(database, "live-canary");
  const member = await provisionMember(
    database,
    administrator.owner,
    "live-canary-member@example.com",
  );
  const organizationId = z
    .string()
    .parse(member.context.caller?.organizationId);
  if (settings.CANARY_INSTANCE_MODE === "saas")
    handles.mail = await startMailpit();
  const { runtime, app } = await startApi({
    database,
    publicUrl,
    port: settings.CANARY_PORT,
    assets,
    instanceMode: settings.CANARY_INSTANCE_MODE,
    mail: handles.mail,
  });
  handles.runtime = runtime;
  handles.app = app;
  if (handles.mail) {
    for (const principal of [administrator, member])
      await verifyCanaryEmail(publicUrl, principal.email, handles.mail);
    assert.equal(
      await database.prisma.user.count({
        where: {
          email: { in: [administrator.email, member.email] },
          emailVerified: true,
        },
      }),
      2,
    );
  }
  const read = await runtime.services.auth.createKey(member.owner, {
    name: "Live canary MCP reader",
    // The canary exercises dashboard_render, which the default catalog no longer exposes.
    permissions: { sessions: ["read"], tools: ["dashboards"] },
  });
  const userClient = await connectMcp(publicUrl, read.result.key);
  handles.clients.push(userClient);
  const adminClient = await connectMcp(publicUrl, administrator.key);
  handles.clients.push(adminClient);
  const catalog = await measureCatalog(userClient, adminClient);
  report.catalog = catalog;
  handles.browser = await chromium.launch();
  const { page, browserErrors } = await mobilePage(
    handles.browser,
    publicUrl,
    z.string().parse(member.owner.headers.get("cookie")),
  );
  const context: CanaryContext = {
    root,
    directory,
    runId,
    publicUrl,
    output: settings.CANARY_OUTPUT,
    database,
    organizationId,
    administrator,
    member,
    readKey: read.result.key,
    userClient,
    page,
    browserErrors,
    report,
  };
  // Native MCP usage runs after the separate agent check so that check still sees
  // exactly one root session per capture marker.
  const captured: CapturedHarness[] = [];
  for (const definition of selectedHarnesses)
    captured.push(await captureHarness(context, definition));
  const agentMcp = await agentMcpCheck(context, captured);
  for (const item of captured) await nativeToolStage(context, item);
  for (const item of captured) await organicRecallStage(context, item);
  assertCatalogWithinBudget(catalog);
  const billing = (await runtime.services.billing.usage(administrator.owner))
    .result;
  if (settings.CANARY_INSTANCE_MODE === "saas") {
    const admitted = await database.prisma.usageAdmission.count({
      where: { organizationId, kind: "capture" },
    });
    const nativeRecords = await database.prisma.traceSourceAdmission.count({
      where: { organizationId },
    });
    assert.equal(billing.plan, "free");
    assert.equal(billing.included_records, 1000);
    assert.ok(admitted > 0);
    assert.equal(billing.records_used, admitted);
    assert.equal(admitted, nativeRecords);
  }
  const path = await writeReport(settings.CANARY_OUTPUT, {
    passed: true,
    instance_mode: settings.CANARY_INSTANCE_MODE,
    billing: { plan: billing.plan, records_used: billing.records_used },
    captured_at: new Date().toISOString(),
    harnesses: report.harnesses,
    agent_mcp: { passed: true, ...agentMcp },
    native_tools: report.native_tools,
    organic_recall: report.organic_recall,
    catalog,
  });
  console.log(`All four live canaries passed. Report: ${path}`);
  if (settings.CANARY_KEEP_RUNNING)
    await keepRunning(handles, {
      publicUrl,
      accessPath: join(directory, "preview-access.json"),
      access: {
        pid: process.pid,
        public_url: publicUrl,
        database_urls: database.urls,
        trace_config: database.traceConfig,
        trace_migration: database.traceMigration,
        auth_secret: testAuthConfiguration.secret,
        organization_id: organizationId,
        administrator_email: administrator.email,
        member_email: member.email,
        instance_mode: settings.CANARY_INSTANCE_MODE,
        smtp_url: handles.mail?.smtpUrl ?? null,
        mailpit_url: handles.mail?.url ?? null,
      },
    });
} catch (error) {
  try {
    const failures = await database.prisma.auditEvent.findMany({
      where: { statusCode: { gte: 400 } },
      orderBy: { ts: "desc" },
      take: 20,
      select: {
        ts: true,
        action: true,
        resourceIds: true,
        statusCode: true,
        detail: true,
      },
    });
    await writeFile(
      join(directory, "failure-audits.json"),
      JSON.stringify(failures, null, 2) + "\n",
      { mode: 0o600 },
    );
  } catch {
    // Database diagnostics must never replace the original failed canary assertion.
  }
  const path = await writeReport(settings.CANARY_OUTPUT, {
    passed: false,
    harnesses: report.harnesses,
    native_tools: report.native_tools,
    organic_recall: report.organic_recall,
    catalog: report.catalog,
    error:
      error instanceof Error
        ? error.message
        : "The live canary did not complete.",
    private_logs: directory,
  });
  console.error(`Live canary failed. Report: ${path}`);
  process.exitCode = 1;
} finally {
  const errors = await cleanup([
    async () => handles.browser?.close(),
    ...handles.clients.map((client) => () => client.close()),
    async () => handles.app?.close(),
    async () => handles.runtime?.close(),
    async () => handles.mail?.close(),
    () => database.close(),
  ]);
  if (errors.length) {
    console.error(
      `Live canary cleanup failed for ${String(errors.length)} resources.`,
    );
    process.exitCode = 1;
  }
}
