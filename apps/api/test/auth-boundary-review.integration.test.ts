import { startTraceDatabase } from "../../../packages/traces/test/support.js";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { provisionOrganization, releaser } from "./support.js";
import { startApp, type StartedApp } from "./app.js";

let database: Awaited<ReturnType<typeof startTraceDatabase>>;
let runtime: StartedApp["runtime"];
let app: StartedApp["app"];
let owner: Awaited<ReturnType<typeof provisionOrganization>>;
const { defer, release } = releaser();
beforeAll(async () => {
  database = await startTraceDatabase();
  defer(() => database.close());
  owner = await provisionOrganization(database, "boundary-review");
  // Every protocol message here is audited on its own: these tests assert the audit
  // boundary of each response, so identical handshakes are not folded (ADR 0073, whose
  // window `transport` covers).
  const started = await startApp(database, {
    MCP_HANDSHAKE_WINDOW_SECONDS: "0",
  });
  defer(() => started.close());
  ({ runtime, app } = started);
});
afterAll(release);

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
