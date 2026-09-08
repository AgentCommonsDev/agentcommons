import { cleanup as cleanupAll } from "../../../scripts/cleanup.js";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import {
  startDatabase,
  provisionOrganization,
  testAuthConfiguration,
} from "./support.js";
import { createRuntime } from "../src/main.js";
import { createApp } from "../src/app.js";
import { environment } from "../src/env.js";
import type { FastifyInstance } from "fastify";

let database: Awaited<ReturnType<typeof startDatabase>>;
let runtime: Awaited<ReturnType<typeof createRuntime>>;
let app: FastifyInstance;
let owner: Awaited<ReturnType<typeof provisionOrganization>>;
const release: Array<() => Promise<unknown>> = [];
beforeAll(async () => {
  database = await startDatabase();
  release.unshift(() => database.close());
  owner = await provisionOrganization(database, "boundary-review");
  const env = environment({
    PUBLIC_URL: testAuthConfiguration.publicUrl,
    BETTER_AUTH_SECRET: testAuthConfiguration.secret,
    DATABASE_URL: database.urls.app,
    DATABASE_READER_USER_URL: database.urls.user,
    DATABASE_READER_ADMIN_URL: database.urls.admin,
    LOG_LEVEL: "silent",
  });
  runtime = await createRuntime(env);
  release.unshift(() => runtime.close());
  app = await createApp({ env, services: runtime.services, static: false });
  release.unshift(() => app.close());
});
afterAll(async () => {
  expect(await cleanupAll(release.splice(0))).toEqual([]);
});

// @req R-ORG-10
it("organization switcher membership listing requires a browser session", async () => {
  const result = await app.inject({
    method: "GET",
    url: "/api/v1/me/organizations",
    headers: { authorization: `Bearer ${owner.key}` },
  });
  expect(result.statusCode).toBe(403);
});

// @req R-AUD-01
it("MCP SDK schema rejection writes exactly one audit row", async () => {
  const before = await database.prisma.auditEvent.count();
  const response = await app.inject({
    method: "POST",
    url: "/mcp",
    headers: {
      authorization: `Bearer ${owner.key}`,
      accept: "application/json, text/event-stream",
    },
    payload: { jsonrpc: "2.0", id: 1, method: "tools/call", params: {} },
  });
  expect(response.json<unknown>()).toMatchObject({
    error: { code: -32603 },
  });
  expect(await database.prisma.auditEvent.count()).toBe(before + 1);
});

// @req R-AUD-01
it.each(["GET", "DELETE"] as const)(
  "unsupported MCP %s is audited once",
  async (method) => {
    const before = await database.prisma.auditEvent.count();
    const response = await app.inject({ method, url: "/mcp" });
    expect(response.statusCode).toBe(405);
    expect(response.headers.allow).toBe("POST");
    expect(await database.prisma.auditEvent.count()).toBe(before + 1);
  },
);

// @req R-AUD-01
it.each([
  {
    label: "missing Accept",
    accept: "application/json",
    body: { jsonrpc: "2.0", id: 2, method: "tools/list" },
    expected: 406,
  },
  {
    label: "invalid JSON-RPC envelope",
    accept: "application/json, text/event-stream",
    body: { method: "tools/list" },
    expected: 400,
  },
  {
    label: "missing authentication",
    accept: "application/json, text/event-stream",
    body: { jsonrpc: "2.0", id: 3, method: "tools/list" },
    expected: 401,
  },
])(
  "audits $label once before the protocol response",
  async ({ accept, body, expected }) => {
    const before = await database.prisma.auditEvent.count();
    const response = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        accept,
        ...(expected === 401 ? {} : { authorization: `Bearer ${owner.key}` }),
      },
      payload: body,
    });
    expect(response.statusCode).toBe(expected);
    expect(await database.prisma.auditEvent.count()).toBe(before + 1);
  },
);

// @req R-AUD-01
it.each([
  {
    label: "successful SDK control",
    body: {
      jsonrpc: "2.0",
      id: 4,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "review", version: "1" },
      },
    },
  },
  {
    label: "successful service read",
    body: { jsonrpc: "2.0", id: 5, method: "tools/list" },
  },
  {
    label: "SDK validation error",
    body: { jsonrpc: "2.0", id: 6, method: "tools/call", params: {} },
  },
])("withholds $label response when audit storage fails", async ({ body }) => {
  const before = await database.prisma.auditEvent.count();
  const failure = vi
    .spyOn(runtime.services.audit, "write")
    .mockRejectedValue(new Error("private-audit-storage-failure"));
  try {
    const response = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        authorization: `Bearer ${owner.key}`,
        accept: "application/json, text/event-stream",
      },
      payload: body,
    });
    expect(response.statusCode).toBe(503);
    expect(response.json<unknown>()).toMatchObject({
      code: "AUDIT_UNAVAILABLE",
    });
    expect(response.body).not.toContain("private-audit-storage-failure");
    expect(await database.prisma.auditEvent.count()).toBe(before);
  } finally {
    failure.mockRestore();
  }
});

// @req R-AUD-01
it.each(["{", "{}"])(
  "malformed MCP body %s is a single audited client error",
  async (payload) => {
    const before = await database.prisma.auditEvent.count();
    const response = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        authorization: `Bearer ${owner.key}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      payload,
    });
    expect(response.statusCode).toBe(400);
    expect(await database.prisma.auditEvent.count()).toBe(before + 1);
  },
);
