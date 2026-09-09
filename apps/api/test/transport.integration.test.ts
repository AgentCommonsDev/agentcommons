import {
  startTraceDatabase,
  traceEnvironment,
} from "../../../packages/traces/test/support.js";
import { traceServices } from "./trace-services.js";
import { TraceFixtures } from "../../../packages/traces/test/fixtures.js";
import { OrganizationEmbeddingsService } from "../src/services/organization-embeddings.js";
import { cleanup as cleanupAll } from "../../../scripts/cleanup.js";
import { afterAll, beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { FastifyInstance } from "fastify";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { z } from "zod";
import {
  dashboardSaveToolInputSchema,
  dashboardIdInputSchema,
  dashboardRenderToolInputSchema,
  searchToolInputSchema,
  getInputSchema,
  sqlInputSchema,
  searchOutputSchema,
} from "@agentcommons/core/schemas";
import { formatSearch } from "@agentcommons/core/format";
import { createAuth } from "../src/auth/config.js";
import { createApp } from "../src/app.js";
import { serverInstructions, toolJsonSchema } from "../src/services/mcp.js";
import { environment } from "../src/env.js";
import { MembershipService } from "../src/services/membership.js";
import { SearchService } from "../src/services/search.js";
import { SessionService } from "../src/services/session.js";
import { BillingService } from "../src/services/billing.js";
import { QueryService } from "../src/services/query.js";
import { PolicyService } from "../src/services/policies.js";
import { CursorCodec } from "../src/services/cursor.js";
import { AdminService } from "../src/services/admin.js";
import { SessionEventsService } from "../src/services/session-events.js";
import { HealthService } from "../src/services/health.js";
import type { Services } from "../src/routes/services.js";
import { checkMcpFixture } from "./mcp-fixtures.js";
import { provisionOrganization, testAuthConfiguration } from "./support.js";

let native: ReturnType<typeof traceServices>;
let database: Awaited<ReturnType<typeof startTraceDatabase>>;
let organization: Awaited<ReturnType<typeof provisionOrganization>>;
let other: Awaited<ReturnType<typeof provisionOrganization>>;
let app: FastifyInstance;
let address: string;
let publicId: string;
let readKey: string;
const close: (() => Promise<unknown>)[] = [];
const logs: string[] = [];
function headers(key = organization.key) {
  return { authorization: `Bearer ${key}` };
}
function upload(text: string) {
  return {
    envelopeVersion: 2,
    hook: { sha256: "a".repeat(64), extensionSha256: null },
    harness: "CLAUDE_CODE",
    harnessSessionId: randomUUID(),
    behavior: "sync",
    nativeEvent: "Stop",
    batchId: randomUUID(),
    installationId: randomUUID(),
    sentAt: "2026-09-07T01:00:00Z",
    sourcePos: 0,
    context: {
      cwd: "/repo",
      installation: {
        hostname: "transport-fixture",
        osUser: "developer",
        platform: "linux",
        arch: "x64",
      },
      git: {
        root: "/repo",
        remoteUrl: "git@github.com:rek7/agentcommons.git",
        branch: "main",
        head: "abc123",
      },
      parentHint: null,
    },
    records: [
      {
        pos: 0,
        sourceVersion: 0,
        key: "transport-message",
        line: JSON.stringify({
          type: "user",
          uuid: "transport-message",
          timestamp: "2026-09-07T01:00:00Z",
          message: { content: [{ type: "text", text }] },
        }),
      },
    ],
    cursor: "1:0",
    end: null,
  };
}
beforeAll(async () => {
  database = await startTraceDatabase();
  close.push(() => database.close());
  organization = await provisionOrganization(database, "transport-primary");
  other = await provisionOrganization(database, "transport-other");
  const cursors = new CursorCodec(testAuthConfiguration.secret);
  const deps = {
    prisma: database.prisma,
    readers: database.traceReaders,
    audit: database.audit,
    cursors,
  };
  native = traceServices(database);
  const jobs = native.jobs;
  close.push(() => jobs.stop());
  const query = new QueryService(deps);
  const services: Services = {
    dashboards: new DashboardService({ ...deps, query }),
    organizationEmbeddings: new OrganizationEmbeddingsService({
      ...deps,
      jobs,
    }),
    billing: new BillingService({
      ...deps,
      auth: testAuthConfiguration,
      configuration: {
        mode: "customer",
        freeMonthlyRecords: 1000,
        proIncludedRecords: 10000,
        captureCentsPer1000: null,
        embeddingCentsPer1000: null,
        captureEventName: null,
        embeddingEventName: null,
        calComUrl: null,
      },
    }),
    auth: database.auth,
    members: new MembershipService(
      database.prisma,
      testAuthConfiguration,
      database.audit,
    ),
    search: new SearchService(deps),
    sessions: new SessionService(deps),
    query,
    ingest: native.ingest,
    policies: new PolicyService({ ...deps, cache: database.policies }),
    health: new HealthService(database.prisma, database.traces),
    audit: database.audit,
    admin: new AdminService({ ...deps, jobs }),
    jobs,
    events: new SessionEventsService({
      ...deps,
      auth: database.auth,
      intervalMs: 25,
    }),
  };
  const env = environment({
    PUBLIC_URL: testAuthConfiguration.publicUrl,
    DATABASE_URL: database.urls.app,
    ...traceEnvironment(database.traceConfig),
    BETTER_AUTH_SECRET: testAuthConfiguration.secret,
    LOG_LEVEL: "info",
    TRUST_PROXY: "loopback",
  });
  app = await createApp({
    env,
    services,
    static: false,
    loggerStream: {
      write(chunk: string) {
        logs.push(chunk);
      },
    },
  });
  close.push(() => app.close());
  address = await app.listen({ host: "127.0.0.1", port: 0 });
  readKey = (
    await database.auth.createKey(organization.owner, {
      name: "read",
      permissions: { sessions: ["read"] },
    })
  ).result.key;
  const accepted = await app.inject({
    method: "POST",
    url: "/api/v1/ingest",
    headers: {
      ...headers(),
      "content-type": "application/json",
      "content-encoding": "gzip",
    },
    payload: gzipSync(
      JSON.stringify(upload("Investigate the transport session index")),
    ),
  });
  expect(accepted.statusCode, accepted.body).toBe(202);
  publicId = z.object({ sessionId: z.uuid() }).parse(accepted.json()).sessionId;
  await native.projection.process(
    z.string().parse(organization.context.caller?.organizationId),
    publicId,
  );
  const foreign = await app.inject({
    method: "POST",
    url: "/api/v1/ingest",
    headers: { ...headers(other.key), "content-type": "application/json" },
    payload: upload("Foreign tenant secret"),
  });
  expect(foreign.statusCode, foreign.body).toBe(202);
  await native.projection.process(
    z.string().parse(other.context.caller?.organizationId),
    z.object({ sessionId: z.uuid() }).parse(foreign.json()).sessionId,
  );
}, 120_000);
afterAll(async () => {
  expect(await cleanupAll(close.splice(0).reverse())).toEqual([]);
});

// @req R-ARCH-03
it("serves real persisted sessions through the same REST search/get/SQL schemas and bounded CSV page", async () => {
  const search = await app.inject({
    method: "POST",
    url: "/api/v1/search",
    headers: headers(readKey),
    payload: { query: "transport" },
  });
  expect(search.statusCode, search.body).toBe(200);
  expect(search.body).toContain(publicId);
  expect(search.body).not.toContain("Foreign tenant");
  const get = await app.inject({
    method: "GET",
    url: `/api/v1/sessions/${publicId}?from=0&to=0`,
    headers: headers(readKey),
  });
  expect(get.statusCode, get.body).toBe(200);
  const sql = await app.inject({
    method: "POST",
    url: "/api/v1/query",
    headers: headers(readKey),
    payload: { sql: "SELECT session_id FROM sessions" },
  });
  expect(sql.statusCode, sql.body).toBe(200);
  expect(sql.body).toContain(publicId);
  const csv = await app.inject({
    method: "GET",
    url: "/api/v1/sessions?limit=1&format=csv",
    headers: headers(readKey),
  });
  expect(csv.statusCode, csv.body).toBe(200);
  expect(csv.headers["content-type"]).toContain("text/csv");
  expect(csv.body).toContain(publicId);
  const filtered = await app.inject({
    method: "GET",
    url: "/api/v1/sessions?filters[repo_name]=github.com%2Frek7%2Fagentcommons&limit=1",
    headers: headers(readKey),
  });
  expect(filtered.statusCode, filtered.body).toBe(200);
  expect(filtered.body).toContain(publicId);
});

it("rejects foreign resources, caller scope overrides, malformed envelopes and browser writes without a trusted origin", async () => {
  for (const suffix of ["", "/raw", "/tree"])
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/v1/sessions/${publicId}${suffix}`,
          headers: headers(other.key),
        })
      ).statusCode,
    ).toBe(404);
  expect(
    (
      await app.inject({
        method: "GET",
        url: "/api/v1/sessions?organizationId=forged",
        headers: headers(),
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await app.inject({
        method: "GET",
        url: "/api/v1/sessions",
        headers: { ...headers(), "x-organization-id": "forged" },
      })
    ).statusCode,
  ).toBe(401);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/v1/ingest",
        headers: headers(),
        payload: { envelopeVersion: 2 },
      })
    ).statusCode,
  ).toBe(400);
  const cookie = organization.owner.headers.get("cookie") ?? "";
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/v1/me/keys",
        headers: { cookie },
        payload: { name: "browser", permissions: { sessions: ["read"] } },
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/v1/me/keys",
        headers: { cookie, origin: testAuthConfiguration.publicUrl },
        payload: { name: "browser", permissions: { sessions: ["read"] } },
      })
    ).statusCode,
  ).toBe(200);
});

// @req R-SEC-07
it("enforces browser security headers, the configured CORS origin, secure production cookies and an audited body limit", async () => {
  const native = createAuth(database.prisma, {
    ...testAuthConfiguration,
    publicUrl: "https://sessions.example.test",
  });
  const signed = await native.api.signInEmail({
    body: {
      email: organization.email,
      password: "Integration native password 1234!",
    },
    asResponse: true,
  });
  const cookies = signed.headers.getSetCookie();
  expect(cookies.length).toBeGreaterThan(0);
  expect(
    cookies.every(
      (cookie) =>
        cookie.includes("Secure") &&
        cookie.includes("HttpOnly") &&
        cookie.includes("SameSite=Lax"),
    ),
  ).toBe(true);
  const good = await app.inject({
    url: "/api/v1/me",
    headers: { ...headers(), origin: testAuthConfiguration.publicUrl },
  });
  expect(good.headers["access-control-allow-origin"]).toBe(
    testAuthConfiguration.publicUrl,
  );
  expect(good.headers["access-control-allow-credentials"]).toBe("true");
  expect(good.headers["x-content-type-options"]).toBe("nosniff");
  expect(good.headers["x-frame-options"]).toBe("SAMEORIGIN");
  const evil = await app.inject({
    url: "/api/v1/me",
    headers: { ...headers(), origin: "https://elsewhere.test" },
  });
  expect(evil.headers["access-control-allow-origin"]).not.toBe(
    "https://elsewhere.test",
  );
  const large = await app.inject({
    method: "POST",
    url: "/api/v1/ingest",
    headers: { ...headers(), "content-type": "application/json" },
    payload: JSON.stringify({ value: "x".repeat(10 * 1024 * 1024) }),
  });
  expect(large.statusCode).toBe(413);
  expect(
    await database.prisma.auditEvent.count({
      where: {
        statusCode: 413,
        organizationId: organization.context.caller?.organizationId ?? "",
      },
    }),
  ).toBeGreaterThan(0);
});

// @req R-WEB-04 @req R-AUD-02
it("audits authentication failures with trusted proxy identity and excludes health and static assets", async () => {
  const before = await database.prisma.auditEvent.count();
  const health = await app.inject({ url: "/health" });
  expect(health.statusCode).toBe(200);
  expect(health.headers["x-robots-tag"]).toBe("noindex, nofollow, noarchive");
  expect(health.headers["x-content-type-options"]).toBe("nosniff");
  expect((await app.inject({ url: "/ready" })).statusCode).toBe(200);
  expect((await app.inject({ url: "/api/v1/health" })).statusCode).toBe(200);
  expect((await app.inject({ url: "/api/v1/ready" })).statusCode).toBe(200);
  expect((await app.inject({ url: "/api/docs/js/scalar.js" })).statusCode).toBe(
    200,
  );
  expect(await database.prisma.auditEvent.count()).toBe(before);
  const response = await app.inject({
    url: "/api/v1/me",
    headers: { ...headers(), "x-forwarded-for": "192.0.2.123" },
    remoteAddress: "198.51.100.42",
  });
  expect(response.statusCode).toBe(200);
  const latest = await database.prisma.auditEvent.findFirstOrThrow({
    where: { action: "auth.me" },
    orderBy: { ts: "desc" },
  });
  expect(latest.ip).toBe("198.51.100.42");
  const failuresBefore = await database.prisma.auditEvent.count();
  const denied = await app.inject({
    url: "/api/v1/me",
    headers: { "x-forwarded-for": "192.0.2.123" },
    remoteAddress: "127.0.0.1",
  });
  expect(denied.statusCode).toBe(401);
  expect(await database.prisma.auditEvent.count()).toBe(failuresBefore + 1);
  const failure = await database.prisma.auditEvent.findFirstOrThrow({
    where: { action: "auth.failure" },
    orderBy: { ts: "desc" },
  });
  expect(failure).toMatchObject({
    statusCode: 401,
    ip: "192.0.2.123",
    userId: null,
    organizationId: null,
    transport: "rest",
  });
  const invalid = await app.inject({
    method: "POST",
    url: "/auth/sign-in/email",
    headers: { origin: testAuthConfiguration.publicUrl },
    payload: { email: organization.email, password: "Wrong fixture password" },
  });
  expect(invalid.statusCode).toBe(401);
  expect(await database.prisma.auditEvent.count()).toBe(failuresBefore + 2);
});

it("streams initial and changed session snapshots, audits once, and closes after key revocation", async () => {
  const minted = await database.auth.createKey(organization.owner, {
    name: "live events",
    permissions: { sessions: ["read"] },
  });
  const controller = new AbortController();
  const response = await fetch(
    `${address}/api/v1/sessions/${publicId}/events`,
    { headers: headers(minted.result.key), signal: controller.signal },
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/event-stream");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("The event response has no body.");
  const initial = new TextDecoder().decode(
    z.instanceof(Uint8Array).parse((await reader.read()).value),
  );
  expect(initial).toContain("event: session");
  expect(initial).toContain(publicId);
  expect(initial).toContain('"message_count":1');
  await database.prisma.traceSessionControl.update({
    where: {
      organizationId_id: {
        organizationId: z
          .string()
          .parse(organization.context.caller?.organizationId),
        id: publicId,
      },
    },
    data: { status: "ENDED" },
  });
  const changed = new TextDecoder().decode(
    z.instanceof(Uint8Array).parse((await reader.read()).value),
  );
  expect(changed).toContain('"status":"ENDED"');
  expect(
    await database.prisma.auditEvent.count({
      where: { action: "sessions.events", apiKeyId: minted.result.metadata.id },
    }),
  ).toBe(1);
  await database.auth.revokeKey(organization.owner, minted.result.metadata.id, {
    reason: "Close live subscription",
  });
  expect((await reader.read()).done).toBe(true);
  controller.abort();
  expect(
    (
      await app.inject({
        url: `/api/v1/sessions/${publicId}/events`,
        headers: headers(other.key),
      })
    ).statusCode,
  ).toBe(404);
});

// @req R-MOD-01
it("enforces private visibility through REST, SQL, MCP and the uploader's read-only key, then restores it", async () => {
  const client = new Client({ name: "moderation-reader", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${address}/mcp`), {
      requestInit: { headers: headers(readKey) },
    }) as Transport,
  );
  const change = await app.inject({
    method: "POST",
    url: `/api/v1/admin/sessions/${publicId}/visibility`,
    headers: headers(),
    payload: { visibility: "PRIVATE", reason: "Restrict this session" },
  });
  expect(change.statusCode, change.body).toBe(200);
  for (const suffix of ["", "/raw", "/tree", "/events"])
    expect(
      (
        await app.inject({
          url: `/api/v1/sessions/${publicId}${suffix}`,
          headers: headers(readKey),
        })
      ).statusCode,
    ).toBe(404);
  expect(
    (await app.inject({ url: "/api/v1/sessions", headers: headers(readKey) }))
      .body,
  ).not.toContain(publicId);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/v1/search",
        headers: headers(readKey),
        payload: { query: "transport" },
      })
    ).body,
  ).not.toContain(publicId);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/v1/query",
        headers: headers(readKey),
        payload: { sql: "SELECT session_id FROM sessions" },
      })
    ).body,
  ).not.toContain(publicId);
  expect(
    (
      await client.callTool({
        name: "get",
        arguments: { session_id: publicId },
      })
    ).isError,
  ).toBe(true);
  expect(
    JSON.stringify(
      (
        await client.callTool({
          name: "search",
          arguments: { query: "transport" },
        })
      ).structuredContent,
    ),
  ).not.toContain(publicId);
  const visible = await app.inject({
    url: `/api/v1/sessions/${publicId}`,
    headers: headers(),
  });
  expect(visible.statusCode).toBe(200);
  expect(visible.body).toContain('"visibility":"PRIVATE"');
  expect(
    (
      await app.inject({
        method: "POST",
        url: `/api/v1/admin/sessions/${publicId}/visibility`,
        headers: headers(),
        payload: { visibility: "PUBLIC", reason: "Restore access" },
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (
      await app.inject({
        url: `/api/v1/sessions/${publicId}`,
        headers: headers(readKey),
      })
    ).statusCode,
  ).toBe(200);
  await client.close();
});

// @req R-MCP-01
// @req R-MCP-02
// @req R-MCP-03
// @req R-MCP-04
// @req R-MCP-05
// @req R-MCP-09
it("uses the official stateless MCP client with permission-filtered tools, structured results and immediate demotion", async () => {
  // This contract also runs alone; the SSE test changes this shared session status.
  await database.prisma.traceSessionControl.update({
    where: {
      organizationId_id: {
        organizationId: z
          .string()
          .parse(organization.context.caller?.organizationId),
        id: publicId,
      },
    },
    data: { status: "ACTIVE" },
  });
  const client = new Client({ name: "transport-test", version: "1" });
  const transport = new StreamableHTTPClientTransport(
    new URL(`${address}/mcp`),
    { requestInit: { headers: headers(readKey) } },
  );
  await client.connect(transport as Transport);
  close.push(() => client.close());
  const tools = await client.listTools();
  expect(tools.tools.map((tool) => tool.name)).toEqual([
    "dashboard_list",
    "dashboard_get",
    "dashboard_render",
    "dashboard_save",
    "dashboard_delete",
    "search",
    "get",
    "sql",
  ]);
  expect(
    tools.tools
      .filter((tool) => ["search", "get", "sql"].includes(tool.name))
      .every((tool) =>
        tool.description?.startsWith(
          "Use this to check prior work before changing code",
        ),
      ),
  ).toBe(true);
  // The same guidance reaches clients that show server instructions (Claude Code).
  expect(client.getInstructions()).toBe(serverInstructions);
  expect(transport.sessionId).toBeUndefined();
  expect(tools.tools.map((tool) => tool.inputSchema)).toEqual(
    [
      z.strictObject({}),
      dashboardIdInputSchema,
      dashboardRenderToolInputSchema,
      dashboardSaveToolInputSchema,
      dashboardIdInputSchema,
      searchToolInputSchema,
      getInputSchema,
      sqlInputSchema,
    ].map(toolJsonSchema),
  );
  // Claude Code defers every MCP tool behind a search step once definitions near 10% of
  // the context window, so the catalog itself is budgeted (§8.2): no output schemas, no
  // draft URL, no recursion or references, and dashboard inputs in their compact form.
  const catalogBytes = (listed: typeof tools) =>
    new TextEncoder().encode(JSON.stringify(listed.tools)).length;
  expect(catalogBytes(tools)).toBeLessThan(20 * 1024);
  expect(tools.tools.map((tool) => tool.outputSchema)).toEqual(
    tools.tools.map(() => undefined),
  );
  expect(JSON.stringify(tools.tools)).not.toMatch(/"\$(ref|defs|schema)"/);
  const result = await client.callTool({
    name: "search",
    arguments: { query: "transport" },
  });
  expect(result.isError).not.toBe(true);
  expect(JSON.stringify(result.structuredContent)).toContain(publicId);
  expect(JSON.stringify(result.content)).toContain(publicId);
  expect(result.content).toEqual([
    {
      type: "text",
      text: formatSearch(searchOutputSchema.parse(result.structuredContent))
        .text,
    },
  ]);
  const denied = await client.callTool({
    name: "purge",
    arguments: { session_id: publicId, reason: "Not authorized" },
  });
  expect(denied.isError).toBe(true);
  const adminClient = new Client({ name: "admin-test", version: "1" });
  await adminClient.connect(
    new StreamableHTTPClientTransport(new URL(`${address}/mcp`), {
      requestInit: { headers: headers() },
    }) as Transport,
  );
  close.push(() => adminClient.close());
  const adminTools = await adminClient.listTools();
  expect(adminTools.tools.map((tool) => tool.name)).toEqual([
    "dashboard_list",
    "dashboard_get",
    "dashboard_render",
    "dashboard_save",
    "dashboard_delete",
    "search",
    "get",
    "sql",
    "set_visibility",
    "purge",
    "audit",
    "status",
    "dashboard_set_default",
  ]);
  expect(catalogBytes(adminTools)).toBeLessThan(25 * 1024);
  expect(JSON.stringify(adminTools.tools)).not.toMatch(
    /"\$(ref|defs|schema)"|"outputSchema"/,
  );
  const getResult = await client.callTool({
    name: "get",
    arguments: { session_id: publicId },
  });
  const sqlResult = await client.callTool({
    name: "sql",
    arguments: {
      sql: "SELECT session_id, title FROM sessions ORDER BY session_id",
    },
  });
  await checkMcpFixture({
    tools: adminTools.tools,
    search: result.structuredContent,
    get: getResult.structuredContent,
    sql: sqlResult.structuredContent,
  });
  await database.prisma.member.updateMany({
    where: {
      organizationId: organization.context.caller?.organizationId ?? "",
      userId: organization.context.caller?.userId ?? "",
    },
    data: { role: "member" },
  });
  const cachedCall = await adminClient.callTool({
    name: "purge",
    arguments: { session_id: publicId, reason: "Cached admin tool" },
  });
  expect(cachedCall.isError).toBe(true);
  expect(
    (await adminClient.listTools()).tools.map((tool) => tool.name),
  ).toEqual([
    "dashboard_list",
    "dashboard_get",
    "dashboard_render",
    "dashboard_save",
    "dashboard_delete",
    "search",
    "get",
    "sql",
  ]);
  for (const method of ["GET", "DELETE"] as const)
    expect((await app.inject({ method, url: "/mcp" })).statusCode).toBe(405);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/mcp",
        payload: { jsonrpc: "2.0", id: 1, method: "tools/list" },
      })
    ).statusCode,
  ).toBe(401);
});

// @req R-RED-08
it("omits request bodies, credentials and source record lines from captured API logs", async () => {
  const marker = "log-capture-sensitive-request-marker";
  const response = await app.inject({
    method: "POST",
    url: `/api/v1/ingest?token=${marker}`,
    headers: headers(other.key),
    payload: { records: [{ line: marker }], password: marker },
  });
  expect(response.statusCode).toBe(400);
  app.log.info(
    { body: { password: marker }, records: [{ line: marker }] },
    "Logger redaction check",
  );
  const output = logs.join("");
  expect(output.length).toBeGreaterThan(0);
  expect(output).not.toContain(marker);
  expect(output).not.toContain(other.key);
  for (const line of output.trim().split("\n"))
    expect(
      z.record(z.string(), z.unknown()).parse(JSON.parse(line)),
    ).not.toHaveProperty("body");
});

// @req R-SRCH-13
it("applies the same typed live tool conditions through REST, MCP and session CSV", async () => {
  const envelope = upload("Structured transport condition");
  envelope.records = [
    {
      pos: 0,
      sourceVersion: 0,
      key: "condition-call",
      line: JSON.stringify({
        type: "assistant",
        uuid: "condition-call",
        timestamp: "2026-09-07T01:00:00Z",
        message: {
          content: [
            {
              type: "tool_use",
              id: "new-vendor-call",
              name: "mcp__NewVendor__Search",
              input: {
                padding: "x".repeat(2048),
                options: {
                  limit: 2,
                  active: true,
                  missingValue: null,
                  "dot.key": ["Auth%_literal"],
                },
              },
            },
          ],
        },
      }),
    },
  ];
  const ingest = await app.inject({
    method: "POST",
    url: "/api/v1/ingest",
    headers: headers(),
    payload: envelope,
  });
  expect(ingest.statusCode, ingest.body).toBe(202);
  const sessionId = z
    .object({ sessionId: z.uuid() })
    .parse(ingest.json()).sessionId;
  await native.projection.process(
    z.string().parse(organization.context.caller?.organizationId),
    sessionId,
  );
  const filters = {
    where: [
      { field: "tool_name", op: "contains", value: "newvendor" },
      { field: "tool_input", path: ["options", "limit"], op: "eq", value: 2 },
      {
        field: "tool_input",
        path: ["options", "active"],
        op: "eq",
        value: true,
      },
      {
        field: "tool_input",
        path: ["options", "missingValue"],
        op: "eq",
        value: null,
      },
      {
        field: "tool_input",
        path: ["options", "dot.key", "0"],
        op: "starts_with",
        value: "auth%_",
      },
    ],
  };
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/search",
    headers: headers(readKey),
    payload: { query: "", filters, context: 0 },
  });
  expect(response.statusCode, response.body).toBe(200);
  const result = searchOutputSchema.parse(response.json());
  expect(result.blocks.map((block) => block.session_id)).toEqual([sessionId]);
  const client = new Client({ name: "structured-search-test", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${address}/mcp`), {
      requestInit: { headers: headers(readKey) },
    }) as Transport,
  );
  try {
    const mcp = await client.callTool({
      name: "search",
      arguments: { query: "", filters, context: 0 },
    });
    expect(mcp.isError).not.toBe(true);
    expect(mcp.structuredContent).toEqual(result);
    const invalid = await client.callTool({
      name: "search",
      arguments: {
        query: "",
        filters: { where: [{ field: "organization_id", op: "exists" }] },
      },
    });
    expect(invalid.isError).toBe(true);
  } finally {
    await client.close();
  }
  const encoded = encodeURIComponent(JSON.stringify(filters));
  for (const format of ["json", "csv"]) {
    const list = await app.inject({
      method: "GET",
      url: `/api/v1/sessions?filters=${encoded}&format=${format}`,
      headers: headers(readKey),
    });
    expect(list.statusCode, list.body).toBe(200);
    expect(list.body).toContain(sessionId);
    expect(list.body).not.toContain(publicId);
  }
  const foreign = await app.inject({
    method: "POST",
    url: "/api/v1/search",
    headers: headers(other.key),
    payload: { query: "", filters },
  });
  expect(searchOutputSchema.parse(foreign.json()).blocks).toEqual([]);
  for (const where of [
    [{ field: "tool_input", op: "eq", value: 2 }],
    [{ field: "tool_name", op: "regex", value: ".*" }],
  ]) {
    const invalid = await app.inject({
      method: "POST",
      url: "/api/v1/search",
      headers: headers(readKey),
      payload: { query: "", filters: { where } },
    });
    expect(invalid.statusCode, invalid.body).toBe(400);
  }
});

// @req R-GET-01 @req R-LNK-06 @req R-DASH-17 @req R-DASH-10
it("serves concurrent dashboard detail requests over HTTP on a populated native corpus", async () => {
  const source = await database.prisma.traceSessionControl.findFirstOrThrow({
    where: { id: publicId },
  });
  const fixtures = new TraceFixtures(database);
  try {
    for (let index = 0; index < 55; index++)
      await fixtures.session({
        organizationId: source.organizationId,
        userId: source.userId,
        keyId: source.ingestApiKeyId,
        installationId: source.installationId,
        fields: { title: `Concurrent detail background ${String(index)}` },
      });
    const paths = [
      "",
      "/raw",
      "/tree",
      "/reuse?direction=by",
      "/reuse?direction=from",
    ];
    for (const count of [5, 15]) {
      const requestPaths = Array.from(
        { length: count / paths.length },
        () => paths,
      ).flat();
      const responses = await Promise.all(
        requestPaths.map(async (path) => {
          const response = await fetch(
            `${address}/api/v1/sessions/${publicId}${path}`,
            {
              headers: { ...headers(), "x-forwarded-for": "2001:db8::cafe" },
            },
          );
          return { path, status: response.status, body: await response.text() };
        }),
      );
      expect(responses.map(({ path, status }) => ({ path, status }))).toEqual(
        requestPaths.map((path) => ({ path, status: 200 })),
      );
      expect(responses[0]?.body).toContain(
        "Investigate the transport session index",
      );
      expect(
        responses.every(({ body }) => !body.includes("Foreign tenant secret")),
      ).toBe(true);
    }
  } finally {
    await fixtures.close();
  }
});

it("closes active event streams during server shutdown", async () => {
  const response = await fetch(
    `${address}/api/v1/sessions/${publicId}/events`,
    { headers: headers(readKey) },
  );
  const reader = response.body?.getReader();
  if (!reader) throw new Error("The event response has no body.");
  expect((await reader.read()).done).toBe(false);
  await app.close();
  expect((await reader.read()).done).toBe(true);
});
import { DashboardService } from "../src/services/dashboards.js";
