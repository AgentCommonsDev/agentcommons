import {
  startTraceDatabase,
  traceEnvironment,
} from "../../../packages/traces/test/support.js";
import { traceServices } from "./trace-services.js";
import { TraceFixtures } from "../../../packages/traces/test/fixtures.js";
import { OrganizationEmbeddingsService } from "../src/services/organization-embeddings.js";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { gzipSync } from "node:zlib";
import type { FastifyInstance } from "fastify";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { z } from "zod";
import {
  dashboardSaveToolInputSchema,
  dashboardIdInputSchema,
  dashboardRenderToolInputSchema,
  searchToolInputSchema,
  getToolInputSchema,
  getOutputSchema,
  messageRowSchema,
  sqlInputSchema,
  searchOutputSchema,
} from "@agentcommons/core/schemas";
import { formatCsv, formatSearch } from "@agentcommons/core/format";
import { createAuth } from "../src/auth/config.js";
import { createApp } from "../src/app.js";
import {
  administrationToolNames,
  adminToolNames,
  dashboardAdminToolNames,
  dashboardToolNames,
  readToolNames,
  serverInstructions,
  toolJsonSchema,
} from "../src/services/mcp.js";
import { adminRoutes } from "../src/routes/admin-routes.js";
import { domainEnrollmentEnabled } from "../src/auth/config.js";
import { requireCaller } from "../src/services/context.js";
import { environment, type Env } from "../src/env.js";
import { DashboardService } from "../src/services/dashboards.js";
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
import { managementPermissions } from "@agentcommons/core/format/mcp-registration";
import { logCapture, mcpClient, startApp } from "./app.js";
import { testEnvelope, textRecord } from "./envelopes.js";
import {
  provisionOrganization,
  releaser,
  testAccountPassword,
  testAuthConfiguration,
  testBillingConfig,
} from "./support.js";

let native: ReturnType<typeof traceServices>;
let database: Awaited<ReturnType<typeof startTraceDatabase>>;
let organization: Awaited<ReturnType<typeof provisionOrganization>>;
let other: Awaited<ReturnType<typeof provisionOrganization>>;
let env: Env;
let services: Services;
let app: FastifyInstance;
let address: string;
let publicId: string;
let readKey: string;
const { defer, release } = releaser();
const { logs, stream } = logCapture();
function headers(key = organization.key) {
  return { authorization: `Bearer ${key}` };
}
function upload(text: string) {
  return testEnvelope({
    sentAt: "2026-09-07T01:00:00Z",
    cursor: "1:0",
    context: {
      installation: { hostname: "transport-fixture" },
      git: {
        root: "/repo",
        remoteUrl: "git@github.com:rek7/agentcommons.git",
        branch: "main",
        head: "abc123",
      },
    },
    records: [
      {
        ...textRecord(0, text, {
          uuid: "transport-message",
          timestamp: "2026-09-07T01:00:00Z",
        }),
        key: "transport-message",
      },
    ],
  });
}
beforeAll(async () => {
  database = await startTraceDatabase();
  defer(() => database.close());
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
  defer(() => native.close());
  const query = new QueryService(deps);
  services = {
    dashboards: new DashboardService({ ...deps, query }),
    organizationEmbeddings: new OrganizationEmbeddingsService({
      ...deps,
      jobs,
    }),
    billing: new BillingService({
      ...deps,
      auth: testAuthConfiguration,
      configuration: testBillingConfig({ mode: "customer" }),
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
    admin: new AdminService({
      ...deps,
      jobs,
      server: { version: "test-release", autoUpdate: false },
    }),
    jobs,
    events: new SessionEventsService({
      ...deps,
      auth: database.auth,
      intervalMs: 25,
    }),
  };
  env = environment({
    PUBLIC_URL: testAuthConfiguration.publicUrl,
    DATABASE_URL: database.urls.app,
    ...traceEnvironment(database.traceConfig),
    BETTER_AUTH_SECRET: testAuthConfiguration.secret,
    LOG_LEVEL: "info",
    TRUST_PROXY: "loopback",
  });
  app = await createApp({ env, services, static: false, loggerStream: stream });
  defer(() => app.close());
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
afterAll(release);

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

// @req R-DASH-38
it("streams a whole session as one CSV attachment from the same read and refuses a foreign session with the JSON error", async () => {
  const csv = await app.inject({
    method: "GET",
    url: `/api/v1/sessions/${publicId}?format=csv`,
    headers: headers(readKey),
  });
  expect(csv.statusCode, csv.body).toBe(200);
  expect(csv.headers["content-type"]).toContain("text/csv");
  expect(csv.headers["content-disposition"]).toBe(
    `attachment; filename="session-${publicId}.csv"`,
  );
  const json = getOutputSchema.parse(
    (
      await app.inject({
        method: "GET",
        url: `/api/v1/sessions/${publicId}`,
        headers: headers(readKey),
      })
    ).json(),
  );
  expect(json.next).toBeNull();
  expect(json.messages.length).toBeGreaterThan(0);
  // The file is the shared formatter over the JSON messages minus the paging cursor.
  const columns = Object.keys(messageRowSchema.shape);
  expect(csv.body).toBe(
    formatCsv(
      json.messages.map((message) =>
        Object.fromEntries(
          columns.map((column) => [
            column,
            message[column as keyof typeof message],
          ]),
        ),
      ),
    ),
  );
  const foreign = await app.inject({
    method: "GET",
    url: `/api/v1/sessions/${publicId}?format=csv`,
    headers: headers(other.key),
  });
  expect(foreign.statusCode).toBe(404);
  expect(foreign.headers["content-type"]).toContain("application/json");
  expect(foreign.json()).toMatchObject({ code: "SESSION_NOT_FOUND" });
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
    body: { email: organization.email, password: testAccountPassword },
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

// @req R-AUTH-06 @req R-AUD-02
it("answers a valid key with 503 AUTH_UNAVAILABLE and Retry-After when verification fails, on REST and MCP alike", async () => {
  const failuresBefore = await database.prisma.auditEvent.count({
    where: { action: "auth.failure" },
  });
  const verify = vi
    .spyOn(services.auth.native.api, "verifyApiKey")
    .mockRejectedValue(new Error("canceling statement due to lock timeout"));
  try {
    const rest = await app.inject({ url: "/api/v1/me", headers: headers() });
    expect(rest.statusCode).toBe(503);
    expect(rest.headers["retry-after"]).toBe("5");
    expect(rest.json()).toMatchObject({
      code: "AUTH_UNAVAILABLE",
      detail: { retry_after: 5 },
    });
    const ingest = await app.inject({
      method: "POST",
      url: "/api/v1/ingest",
      headers: { ...headers(), "content-type": "application/json" },
      payload: upload("Held back by an overloaded server"),
    });
    expect(ingest.statusCode).toBe(503);
    expect(ingest.json()).toMatchObject({ code: "AUTH_UNAVAILABLE" });
    const mcp = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        ...headers(),
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      payload: { jsonrpc: "2.0", id: 1, method: "tools/list" },
    });
    expect(mcp.statusCode).toBe(503);
    expect(mcp.json()).toMatchObject({ code: "AUTH_UNAVAILABLE" });
  } finally {
    verify.mockRestore();
  }
  const failures = await database.prisma.auditEvent.findMany({
    where: { action: "auth.failure" },
    orderBy: { ts: "asc" },
    skip: failuresBefore,
  });
  expect(failures.map((row) => row.statusCode)).toEqual([503, 503, 503]);
  expect(failures[0]?.detail).toMatchObject({ code: "AUTH_UNAVAILABLE" });
  // The cause reaches the request log with the request id and no body or key.
  const logged = logs.filter((line) => line.includes("AUTH_UNAVAILABLE"));
  expect(logged.length).toBeGreaterThanOrEqual(3);
  expect(logged[0]).toContain("lock timeout");
  expect(logged.join("")).not.toContain(organization.key);
  // The same key is accepted as soon as the lookup completes again.
  const recovered = await app.inject({ url: "/api/v1/me", headers: headers() });
  expect(recovered.statusCode).toBe(200);
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
  // Restore the shared fixture for the contract tests that read this session.
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
});

// @req R-MOD-01
it("enforces private visibility through REST, SQL, MCP and the uploader's read-only key, then restores it", async () => {
  const client = await mcpClient(address, readKey, {
    name: "moderation-reader",
  });
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

// @req R-MCP-13
// @req R-MCP-11
// @req R-AUTH-04
it("derives the administration tools from the admin routes and gates them by group and authority", async () => {
  const features = {
    embeddings: false,
    saas: false,
    domainEnrollment: domainEnrollmentEnabled(env.auth),
  };
  const administration = administrationToolNames(features);
  const organizationId = requireCaller(organization.owner).organizationId;
  const userId = requireCaller(organization.owner).userId;
  const membership = {
    where: { organizationId, userId },
  };
  // One tool per admin route that no standing admin tool covers, named admin_<resource>_<verb>.
  expect(administration).toEqual(
    adminRoutes
      .filter(
        (route) =>
          !adminToolNames.some((name) => name === route.tool) &&
          (route.feature === undefined || features[route.feature]),
      )
      .map((route) => route.tool),
  );
  expect(administration.length).toBeGreaterThanOrEqual(23);
  expect(administration.every((name) => /^admin_[a-z_]+$/.test(name))).toBe(
    true,
  );
  // An admin key without the group lists the standing admin tools only, and a cached
  // client cannot call a derived tool: the refusal names the grant.
  const adminClient = await mcpClient(address, organization.key, {
    name: "admin-without-group",
    defer,
  });
  expect(
    (await adminClient.listTools()).tools.map((tool) => tool.name),
  ).toEqual([...readToolNames, ...adminToolNames]);
  const ungranted = await adminClient.callTool({
    name: "admin_members_list",
    arguments: {},
  });
  expect(ungranted.isError).toBe(true);
  expect(JSON.stringify(ungranted.content)).toContain("TOOL_NOT_GRANTED");
  expect(JSON.stringify(ungranted.content)).toContain("administration");
  // The group needs admin permission on the same key; the shared schema refuses the pair.
  await expect(
    database.auth.createKey(organization.owner, {
      name: "administration without admin",
      permissions: { sessions: ["read"], tools: ["administration"] },
    }),
  ).rejects.toThrow(/administration tools need admin permission/);
  const administrator = (
    await database.auth.createKey(organization.owner, {
      name: "administrator",
      permissions: {
        sessions: ["read"],
        tools: ["administration"],
        admin: ["*"],
      },
    })
  ).result.key;
  const client = await mcpClient(address, administrator, {
    name: "administrator-test",
    defer,
  });
  const tools = await client.listTools();
  expect(tools.tools.map((tool) => tool.name)).toEqual([
    ...readToolNames,
    ...adminToolNames,
    ...administration,
  ]);
  // The administration catalog has its own budget (§8.2); every input is an object schema
  // without references, and the summary of the route is the description.
  const bytes = new TextEncoder().encode(JSON.stringify(tools.tools)).length;
  expect(bytes).toBeLessThan(40 * 1024);
  expect(JSON.stringify(tools.tools)).not.toMatch(
    /"\$(ref|defs|schema)"|"outputSchema"/,
  );
  for (const tool of tools.tools) expect(tool.inputSchema.type).toBe("object");
  for (const route of adminRoutes.filter((route) =>
    administration.includes(route.tool),
  )) {
    const tool = tools.tools.find((tool) => tool.name === route.tool);
    expect(tool?.description).toContain(route.summary);
    expect(tool?.annotations?.readOnlyHint).toBe(route.readOnly);
    expect(tool?.annotations?.destructiveHint).toBe(route.destructive ?? false);
  }
  // The REST `format` switch is not advertised and not accepted.
  expect(
    Object.keys(
      z
        .object({ properties: z.record(z.string(), z.unknown()) })
        .parse(
          tools.tools.find((tool) => tool.name === "admin_members_list")
            ?.inputSchema,
        ).properties,
    ),
  ).not.toContain("format");
  expect(
    (
      await client.callTool({
        name: "admin_members_list",
        arguments: { format: "csv" },
      })
    ).isError,
  ).toBe(true);
  // One round trip per resource family runs the same service the REST route runs and
  // writes exactly one audit event, as an MCP call of the administrator key.
  const audited = () =>
    database.prisma.auditEvent.count({
      where: {
        organizationId,
        transport: "mcp",
        statusCode: { lt: 400 },
        action: { notIn: ["mcp.tools.list", "mcp.protocol", "mcp.call"] },
      },
    });
  const roundTrip = async (name: string, args: Record<string, unknown>) => {
    const before = await audited();
    const result = await client.callTool({ name, arguments: args });
    expect(
      result.isError,
      `${name}: ${JSON.stringify(result.content)}`,
    ).not.toBe(true);
    expect(await audited(), name).toBe(before + 1);
    return z.record(z.string(), z.unknown()).parse(result.structuredContent);
  };
  const members = await roundTrip("admin_members_list", {});
  expect(
    z.object({ items: z.array(z.unknown()) }).parse(members).items.length,
  ).toBeGreaterThan(0);
  await roundTrip("admin_keys_list", { limit: 5 });
  await roundTrip("admin_sessions_list", { roots_only: true });
  await roundTrip("admin_metrics_list", {
    group: "usage",
    filters: {
      date_from: "2026-09-01T00:00:00Z",
      date_to: "2026-09-08T00:00:00Z",
    },
  });
  await roundTrip("admin_domains_list", {});
  await roundTrip("admin_policies_list", {});
  const policy = z.object({ id: z.uuid() }).parse(
    await roundTrip("admin_policy_create", {
      name: "transport-admin-policy",
      kind: "REGEX",
      pattern: "transport-secret-[0-9]+",
      replacement: "[transport-redacted]",
    }),
  );
  await roundTrip("admin_policy_update", {
    id: policy.id,
    name: "transport-admin-policy",
    kind: "REGEX",
    pattern: "transport-secret-[0-9a-f]+",
    replacement: "[transport-redacted]",
  });
  expect(
    z.object({ matches: z.array(z.unknown()) }).parse(
      await roundTrip("admin_redaction_test", {
        text: "transport-secret-42",
      }),
    ).matches.length,
  ).toBeGreaterThan(0);
  await roundTrip("admin_policy_remove", {
    id: policy.id,
    reason: "Transport administration test",
  });
  await roundTrip("admin_redaction_summary", {});
  await roundTrip("admin_redaction_hits_list", {});
  const job = z.object({ job_id: z.string() }).parse(
    await roundTrip("admin_rescan_start", {
      reason: "Transport administration test",
    }),
  );
  await roundTrip("admin_rescan_get", { id: job.job_id });
  await roundTrip("admin_rescans_list", {});
  // Authority is checked again on every list and call: a key whose holder is demoted keeps
  // the group and loses the tools (403), a member key with the group is never listed.
  await database.prisma.member.updateMany({
    ...membership,
    data: { role: "member" },
  });
  try {
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual([
      ...readToolNames,
    ]);
    const demoted = await client.callTool({
      name: "admin_members_list",
      arguments: {},
    });
    expect(demoted.isError).toBe(true);
    expect(JSON.stringify(demoted.content)).toContain("FORBIDDEN");
  } finally {
    await database.prisma.member.updateMany({
      ...membership,
      data: { role: "owner" },
    });
  }
});

// @req R-DASH-43
// @req R-MCP-13
it("registers agentcommons-admin as an admin-only server whose catalog is the administration tools alone, with no search, get, sql or dashboard tools", async () => {
  const administration = administrationToolNames({
    embeddings: false,
    saas: false,
    domainEnrollment: domainEnrollmentEnabled(env.auth),
  });
  // The clean two-server split (ADR 0072 amendment): the management key grants admin
  // authority and the administration group only, nothing that the everyday server carries.
  expect(managementPermissions).toStrictEqual({
    tools: ["administration"],
    admin: ["*"],
  });
  const managementKey = (
    await database.auth.createKey(organization.owner, {
      name: "management server",
      permissions: { tools: ["administration"], admin: ["*"] },
    })
  ).result.key;
  const client = await mcpClient(address, managementKey, {
    name: "management-server-test",
    defer,
  });
  const names = (await client.listTools()).tools.map((tool) => tool.name);
  // Only the administration tools: the standing admin tools plus the derived admin_* tools.
  expect(names).toEqual([...adminToolNames, ...administration]);
  // No overlap with the everyday agentcommons server, whatever a cached client remembers.
  for (const read of readToolNames) expect(names).not.toContain(read);
  for (const dashboard of dashboardToolNames)
    expect(names).not.toContain(dashboard);
  // An administration tool runs; a read tool the key does not grant is refused on call.
  expect(
    (await client.callTool({ name: "admin_members_list", arguments: {} }))
      .isError,
  ).not.toBe(true);
  const search = await client.callTool({
    name: "search",
    arguments: { query: "transport" },
  });
  expect(search.isError).toBe(true);
});

// @req R-MCP-01
// @req R-MCP-02
// @req R-MCP-03
// @req R-MCP-04
// @req R-MCP-05
// @req R-MCP-09
// @req R-MCP-11
// @req R-DASH-39
it("uses the official stateless MCP client with permission-filtered tools, structured results and immediate demotion", async () => {
  const client = await mcpClient(address, readKey, {
    name: "transport-test",
    defer,
  });
  const tools = await client.listTools();
  // The default catalog is the read tools alone (§8.2): a key created for an install
  // sees search, get and sql and nothing else until it opts into a tool group.
  expect(tools.tools.map((tool) => tool.name)).toEqual([...readToolNames]);
  expect(
    tools.tools.every((tool) =>
      tool.description?.startsWith(
        "Use this to check prior work before changing code",
      ),
    ),
  ).toBe(true);
  // The same guidance reaches clients that show server instructions (Claude Code).
  expect(client.getInstructions()).toBe(serverInstructions);
  expect(client.transport?.sessionId).toBeUndefined();
  expect(tools.tools.map((tool) => tool.inputSchema)).toEqual(
    [searchToolInputSchema, getToolInputSchema, sqlInputSchema].map(
      toolJsonSchema,
    ),
  );
  // Claude Code defers every MCP tool behind a search step once definitions near 10% of
  // the context window, so the catalog itself is budgeted (§8.2): no output schemas, no
  // draft URL, no recursion or references, and dashboard inputs in their compact form.
  const catalogBytes = (listed: typeof tools) =>
    new TextEncoder().encode(JSON.stringify(listed.tools)).length;
  expect(catalogBytes(tools)).toBeLessThan(12 * 1024);
  expect(tools.tools.map((tool) => tool.outputSchema)).toEqual(
    tools.tools.map(() => undefined),
  );
  expect(JSON.stringify(tools.tools)).not.toMatch(/"\$(ref|defs|schema)"/);
  // A cached client cannot call what its key does not expose: the refusal names the grant.
  const ungranted = await client.callTool({
    name: "dashboard_list",
    arguments: {},
  });
  expect(ungranted.isError).toBe(true);
  expect(JSON.stringify(ungranted.content)).toContain("TOOL_NOT_GRANTED");
  // The dashboards tool group is opt-in on the key and adds exactly the five tools.
  const dashboardsKey = (
    await database.auth.createKey(organization.owner, {
      name: "dashboards",
      permissions: { sessions: ["read"], tools: ["dashboards"] },
    })
  ).result.key;
  const dashboardsClient = await mcpClient(address, dashboardsKey, {
    name: "dashboards-test",
    defer,
  });
  const dashboardsTools = await dashboardsClient.listTools();
  expect(dashboardsTools.tools.map((tool) => tool.name)).toEqual([
    ...readToolNames,
    ...dashboardToolNames,
  ]);
  expect(
    dashboardsTools.tools
      .filter((tool) => tool.name.startsWith("dashboard_"))
      .map((tool) => tool.inputSchema),
  ).toEqual(
    [
      z.strictObject({}),
      dashboardIdInputSchema,
      dashboardRenderToolInputSchema,
      dashboardSaveToolInputSchema,
      dashboardIdInputSchema,
    ].map(toolJsonSchema),
  );
  expect(catalogBytes(dashboardsTools)).toBeLessThan(20 * 1024);
  expect(
    (await dashboardsClient.callTool({ name: "dashboard_list", arguments: {} }))
      .isError,
  ).not.toBe(true);
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
  // Effective admin authority adds the admin tools and nothing from an ungranted group.
  const adminClient = await mcpClient(address, organization.key, {
    name: "admin-test",
    defer,
  });
  expect(
    (await adminClient.listTools()).tools.map((tool) => tool.name),
  ).toEqual([...readToolNames, ...adminToolNames]);
  // The complete catalog needs admin authority and the dashboards group together.
  const completeKey = (
    await database.auth.createKey(organization.owner, {
      name: "complete",
      permissions: { sessions: ["read"], tools: ["dashboards"], admin: ["*"] },
    })
  ).result.key;
  const completeClient = await mcpClient(address, completeKey, {
    name: "complete-test",
    defer,
  });
  const adminTools = await completeClient.listTools();
  expect(adminTools.tools.map((tool) => tool.name)).toEqual([
    ...readToolNames,
    ...dashboardToolNames,
    ...adminToolNames,
    ...dashboardAdminToolNames,
  ]);
  expect(catalogBytes(adminTools)).toBeLessThan(25 * 1024);
  expect(JSON.stringify(adminTools.tools)).not.toMatch(
    /"\$(ref|defs|schema)"|"outputSchema"/,
  );
  // The administrator install's key (§10): both groups and admin authority list every
  // tool, the administration group last, within its own budget (ADR 0072).
  const administratorKey = (
    await database.auth.createKey(organization.owner, {
      name: "administrator install",
      permissions: {
        sessions: ["ingest", "read"],
        tools: ["dashboards", "administration"],
        admin: ["*"],
      },
    })
  ).result.key;
  const administratorClient = await mcpClient(address, administratorKey, {
    name: "administrator-install-test",
    defer,
  });
  const everyTool = await administratorClient.listTools();
  expect(everyTool.tools.map((tool) => tool.name)).toEqual([
    ...readToolNames,
    ...dashboardToolNames,
    ...adminToolNames,
    ...dashboardAdminToolNames,
    ...administrationToolNames({
      embeddings: false,
      saas: false,
      domainEnrollment: domainEnrollmentEnabled(env.auth),
    }),
  ]);
  expect(catalogBytes(everyTool)).toBeLessThan(48 * 1024);
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
    administration: everyTool.tools.filter((tool) =>
      tool.name.startsWith("admin_"),
    ),
    search: result.structuredContent,
    get: getResult.structuredContent,
    sql: sqlResult.structuredContent,
  });
  // The REST page budget and header switch are not part of the advertised tool contract
  // (R-DASH-39): the MCP tool keeps 32 KB pages with the header however a caller asks,
  // while REST bounds the budget and answers messages only on request.
  for (const extra of [{ page_bytes: 262144 }, { header: false }]) {
    const rejected = await client.callTool({
      name: "get",
      arguments: { session_id: publicId, ...extra },
    });
    expect(rejected.isError).toBe(true);
  }
  for (const [query, status, header] of [
    ["page_bytes=262144", 200, true],
    ["page_bytes=1", 400, null],
    ["header=false", 200, false],
  ] as const) {
    const response = await app.inject({
      url: `/api/v1/sessions/${publicId}?${query}`,
      headers: headers(readKey),
    });
    expect(response.statusCode, response.body).toBe(status);
    if (header !== null)
      expect(
        getOutputSchema.parse(response.json()).header !== null,
        query,
      ).toBe(header);
  }
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
  ).toEqual([...readToolNames]);
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

// @req R-MCP-01 @req R-AUD-01
it("answers GET and DELETE on /mcp with 405 from the route and writes no request.failure audit row, while a POST failure is still audited", async () => {
  const failures = () =>
    database.prisma.auditEvent.count({ where: { action: "request.failure" } });
  const before = await failures();
  // The unauthenticated capability probe of the standalone SSE stream and session
  // teardown this stateless transport does not offer: 405 from the route, not an operation.
  for (const method of ["GET", "DELETE"] as const) {
    const probe = await app.inject({ method, url: "/mcp" });
    expect(probe.statusCode).toBe(405);
    expect(probe.headers["allow"]).toBe("POST");
    expect(probe.json()).toEqual({
      code: "METHOD_NOT_ALLOWED",
      message: "Use POST for MCP.",
    });
  }
  // No audit row for either probe: it never reaches the audited failure path.
  expect(await failures()).toBe(before);
  // A genuine POST failure on the same endpoint is still audited, proving the scope is
  // strictly the unsupported-method probe.
  const unauthorized = await app.inject({
    method: "POST",
    url: "/mcp",
    headers: { "content-type": "application/json" },
    payload: { jsonrpc: "2.0", id: 1, method: "tools/list" },
  });
  expect(unauthorized.statusCode).toBe(401);
  expect(await failures()).toBe(before + 1);
});

// @req R-MCP-14 @req R-AUD-01
it("folds identical MCP handshakes from one key and client into one audit row per window while every tool call is audited", async () => {
  // A five-second window so the test observes both sides of it; production uses 300 s.
  const folded = await startApp(
    database,
    { MCP_HANDSHAKE_WINDOW_SECONDS: "5" },
    { listen: true },
  );
  defer(() => folded.close());
  // A fresh organization: earlier tests in this file demote the primary owner.
  const handshake = await provisionOrganization(
    database,
    "transport-handshake",
  );
  const created = await database.auth.createKey(handshake.owner, {
    name: "handshake",
    permissions: { sessions: ["read"] },
  });
  const rows = (action?: string) =>
    database.prisma.auditEvent.findMany({
      where: {
        apiKeyId: created.result.metadata.id,
        ...(action ? { action } : {}),
      },
      orderBy: { ts: "asc" },
      select: { action: true, statusCode: true, detail: true },
    });
  const connect = async (userAgent?: string) => {
    const client = new Client({ name: "handshake-test", version: "1" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${folded.address}/mcp`), {
        requestInit: {
          headers: {
            authorization: `Bearer ${created.result.key}`,
            ...(userAgent ? { "user-agent": userAgent } : {}),
          },
        },
      }) as Transport,
    );
    await client.listTools();
    return client;
  };
  // The same client program reconnecting three times inside the window: one row each
  // for initialize, notifications/initialized and tools/list.
  for (let index = 0; index < 3; index += 1) await (await connect()).close();
  const first = await rows();
  expect(
    first.map((row) => [
      row.action,
      z.object({ method: z.string().optional() }).parse(row.detail).method,
    ]),
  ).toEqual([
    ["mcp.protocol", "initialize"],
    ["mcp.protocol", "notifications/initialized"],
    ["mcp.tools.list", undefined],
  ]);
  expect(first.every((row) => !("repeats" in (row.detail as object)))).toBe(
    true,
  );
  // Another harness on the same installation key keeps its own handshake rows.
  await (await connect("other-harness/1.0")).close();
  expect((await rows()).length).toBe(6);
  // Tool calls are operations audited as what they did (`search`, never folded): three
  // calls, three rows, inside the same window.
  const caller = await connect();
  for (let index = 0; index < 3; index += 1)
    await caller.callTool({
      name: "search",
      arguments: { query: "handshake window" },
    });
  await caller.close();
  expect((await rows("search")).length).toBe(3);
  expect((await rows()).length).toBe(9);
  // The handshake that opens the next window reports what the last one folded.
  await new Promise((resolve) => setTimeout(resolve, 5200));
  await (await connect()).close();
  const listed = await rows("mcp.tools.list");
  expect(listed.length).toBe(3);
  const opened = z
    .object({
      tool_names: z.array(z.string()),
      repeats: z.number().int(),
      repeats_since: z.iso.datetime(),
    })
    .parse(listed.at(-1)?.detail);
  // Three list handshakes were folded after the row that opened the first window: two
  // reconnects plus the caller's own connection.
  expect(opened.repeats).toBe(3);
  expect(opened.tool_names).toEqual([...readToolNames]);
  const initialized = await rows("mcp.protocol");
  expect(
    initialized
      .filter(
        (row) =>
          z.object({ method: z.string() }).parse(row.detail).method ===
          "initialize",
      )
      .map(
        (row) =>
          z.object({ repeats: z.number().optional() }).parse(row.detail)
            .repeats,
      ),
  ).toEqual([undefined, undefined, 3]);
});

// @req R-SEC-08
it("refuses a client program that exhausts its MCP handshake budget while another program on the same key completes initialize, tools/list and search", async () => {
  // A fresh organization and key: the storm spends nothing another test's key relies on.
  const stormed = await provisionOrganization(database, "transport-storm");
  const created = await database.auth.createKey(stormed.owner, {
    name: "storm",
    permissions: { sessions: ["read"] },
  });
  const key = created.result.key;
  // The crash-restart loop of Appendix A: every restart is a new process whose first
  // message is `initialize`. Eight at a time exhaust that program's 600 handshakes per
  // minute within seconds; once refused, each keeps trying at a tenth of a second.
  const storm = { sent: 0, refused: 0, stop: false };
  let firstRefusal: (response: Response) => void = () => undefined;
  const refusal = new Promise<Response>((resolve) => {
    firstRefusal = resolve;
  });
  const initialize = () =>
    fetch(`${address}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "user-agent": "crash-loop/1.0",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "crash-loop", version: "1" },
        },
      }),
    });
  const workers = Array.from({ length: 8 }, async () => {
    while (!storm.stop) {
      const response = await initialize();
      storm.sent += 1;
      if (response.status === 429) {
        storm.refused += 1;
        firstRefusal(response.clone());
        await response.text();
        await new Promise((resolve) => setTimeout(resolve, 100));
      } else {
        expect(response.status).toBe(200);
        await response.text();
      }
    }
  });
  try {
    // The storming program is refused alone, with the body and header every route answers.
    const refused = await refusal;
    expect(refused.headers.get("retry-after")).toMatch(/^\d+$/);
    expect(
      z
        .object({
          code: z.string(),
          detail: z.object({ retry_after: z.number() }),
        })
        .parse(await refused.json()).code,
    ).toBe("RATE_LIMITED");
    expect(storm.sent - storm.refused).toBeGreaterThanOrEqual(600);
    // While the storm continues, a session starting on the same key from another program
    // (Claude Code loads MCP servers once and drops one whose initialize fails) completes
    // its handshake, lists the catalog and runs a tool.
    const fresh = new Client({ name: "fresh-session", version: "1" });
    await fresh.connect(
      new StreamableHTTPClientTransport(new URL(`${address}/mcp`), {
        requestInit: {
          headers: {
            authorization: `Bearer ${key}`,
            "user-agent": "other-harness/1.0",
          },
        },
      }) as Transport,
    );
    defer(() => fresh.close());
    expect((await fresh.listTools()).tools.map((tool) => tool.name)).toEqual([
      ...readToolNames,
    ]);
    const searched = await fresh.callTool({
      name: "search",
      arguments: { query: "handshake storm" },
    });
    expect(searched.isError).toBeFalsy();
    expect(storm.refused).toBeGreaterThan(0);
  } finally {
    storm.stop = true;
    await Promise.all(workers);
  }
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
  const client = await mcpClient(address, readKey, {
    name: "structured-search-test",
  });
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
  // A second server over the same services, so shutting it down leaves the shared app up.
  const closing = await createApp({ env, services, static: false });
  const closingAddress = await closing.listen({ host: "127.0.0.1", port: 0 });
  const response = await fetch(
    `${closingAddress}/api/v1/sessions/${publicId}/events`,
    { headers: headers(readKey) },
  );
  const reader = response.body?.getReader();
  if (!reader) throw new Error("The event response has no body.");
  expect((await reader.read()).done).toBe(false);
  await closing.close();
  expect((await reader.read()).done).toBe(true);
});
