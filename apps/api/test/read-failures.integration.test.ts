import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { z } from "zod";
import { ClickHouseError, TraceReaders } from "@agentcommons/traces";
import { Prisma } from "@agentcommons/db";
import { startTraceDatabase } from "../../../packages/traces/test/support.js";
import type { InjectOptions, LightMyRequestResponse } from "fastify";
import { startApp, type StartedApp, type TraceDatabase } from "./app.js";
import { provisionOrganization, releaser } from "./support.js";

/*
 * Every trace read (search, get, lists, tree, sql) answers a ClickHouse limit or a busy
 * control database with the same stable, retryable code over REST and MCP (§7.5, R-GET-07),
 * and only an unexpected failure stays OPERATION_FAILED. The reader is failed at its single
 * entry, `TraceReaders.read`, so no session data is needed and healthy reads stay 200.
 */
const resources = releaser();
let database: TraceDatabase;
let started: StartedApp;
let headers: Record<string, string>;
const errorBody = z.looseObject({
  code: z.string(),
  message: z.string(),
  detail: z.unknown().optional(),
});
const toolFailure = z.object({
  result: z.object({
    isError: z.literal(true),
    content: z.tuple([z.object({ type: z.literal("text"), text: z.string() })]),
  }),
});
const timeLimit = () =>
  new ClickHouseError({
    code: "159",
    type: "TIMEOUT_EXCEEDED",
    message: "Timeout exceeded: elapsed 5.02 s (query: SELECT secret_value)",
  });
const lockTimeout = () =>
  // The message Prisma builds for a failed raw statement, code and PostgreSQL text included.
  new Prisma.PrismaClientKnownRequestError(
    "Raw query failed. Code: `55P03`. Message: `canceling statement due to lock timeout`",
    {
      code: "P2010",
      clientVersion: "test",
      meta: {
        code: "55P03",
        message: "canceling statement due to lock timeout",
      },
    },
  );
/** Fails the next trace read of any service with `error`. */
function failNextRead(error: unknown) {
  return vi.spyOn(TraceReaders.prototype, "read").mockRejectedValueOnce(error);
}
function rest(
  method: "GET" | "POST",
  url: string,
  payload?: unknown,
): Promise<LightMyRequestResponse> {
  const options: InjectOptions = {
    method,
    url,
    headers: { ...headers, "content-type": "application/json" },
  };
  if (payload !== undefined)
    options.payload = payload as Exclude<InjectOptions["payload"], undefined>;
  return started.app.inject(options);
}
async function callTool(name: string, args: Record<string, unknown>) {
  const response = await started.app.inject({
    method: "POST",
    url: "/mcp",
    headers: {
      ...headers,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    payload: {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    },
  });
  expect(response.statusCode, response.body).toBe(200);
  return errorBody.parse(
    JSON.parse(toolFailure.parse(response.json()).result.content[0].text),
  );
}

beforeAll(async () => {
  database = await startTraceDatabase();
  resources.defer(() => database.close());
  const organization = await provisionOrganization(database, "read-failures");
  started = await startApp(
    database,
    { LOG_LEVEL: "info" },
    { captureLogs: true },
  );
  resources.defer(() => started.close());
  headers = { authorization: `Bearer ${organization.key}` };
}, 180_000);
afterAll(() => resources.release());
afterEach(() => {
  vi.restoreAllMocks();
});

// @req R-GET-07 @req R-SQL-07 @req R-MCP-05
it("answers a ClickHouse time limit on list, get, search and sql with 503 READ_TIME_LIMIT, Retry-After and the same hint over REST and MCP", async () => {
  const reads: [string, () => Promise<LightMyRequestResponse>][] = [
    ["list", () => rest("GET", "/api/v1/sessions?limit=5")],
    ["get", () => rest("GET", `/api/v1/sessions/${randomUUID()}`)],
    ["tree", () => rest("GET", `/api/v1/sessions/${randomUUID()}/tree`)],
    [
      "search",
      () => rest("POST", "/api/v1/search", { query: "circuit breaker" }),
    ],
    [
      "sql",
      () =>
        rest("POST", "/api/v1/query", { sql: "SELECT count() FROM sessions" }),
    ],
  ];
  for (const [name, read] of reads) {
    failNextRead(timeLimit());
    const response = await read();
    expect(`${name} ${String(response.statusCode)}`).toBe(`${name} 503`);
    expect(response.headers["retry-after"]).toBe("5");
    const body = errorBody.parse(response.json());
    expect(body.code).toBe("READ_TIME_LIMIT");
    expect(body.message).toContain("5 second");
    expect(body.message).toContain("search_messages(q=");
    expect(body.message).not.toContain("secret_value");
    expect(body.detail).toMatchObject({ retry_after: 5 });
  }
  for (const [name, args] of [
    ["search", { query: "circuit breaker" }],
    ["get", { session_id: randomUUID() }],
    ["sql", { sql: "SELECT count() FROM sessions" }],
  ] as const) {
    failNextRead(timeLimit());
    const failure = await callTool(name, args);
    expect(failure.code, name).toBe("READ_TIME_LIMIT");
    expect(failure.message).toContain("search_messages(q=");
    expect(failure.detail).toMatchObject({ retry_after: 5 });
  }
  // Healthy reads are untouched: no 5xx once the reader answers.
  const healthy = await rest("GET", "/api/v1/sessions?limit=5");
  expect(healthy.statusCode).toBe(200);
  expect(await callTool("get", { session_id: randomUUID() })).toMatchObject({
    code: "SESSION_NOT_FOUND",
  });
});

// @req R-GET-07
it("answers a control database lock timeout with 503 READ_BUSY and an unexpected reader failure with 500 OPERATION_FAILED, both audited with their cause logged", async () => {
  failNextRead(lockTimeout());
  const busy = await rest("GET", "/api/v1/sessions?limit=5");
  expect(busy.statusCode).toBe(503);
  expect(busy.headers["retry-after"]).toBe("5");
  expect(errorBody.parse(busy.json())).toMatchObject({
    code: "READ_BUSY",
    detail: { retry_after: 5 },
  });
  failNextRead(new Error("unexpected reader failure"));
  const unexpected = await rest("POST", "/api/v1/search", { query: "x" });
  expect(unexpected.statusCode).toBe(500);
  expect(errorBody.parse(unexpected.json()).code).toBe("OPERATION_FAILED");
  const audited = await database.prisma.auditEvent.findMany({
    where: {
      action: { in: ["sessions.list", "search"] },
      statusCode: { gte: 500 },
    },
    orderBy: { ts: "asc" },
  });
  expect(audited.map((row) => [row.action, row.statusCode]).slice(-2)).toEqual([
    ["sessions.list", 503],
    ["search", 500],
  ]);
  const logged = started.logs.filter((line) => line.includes("request failed"));
  expect(
    logged.some(
      (line) => line.includes("READ_BUSY") && line.includes("lock timeout"),
    ),
  ).toBe(true);
  expect(
    logged.some(
      (line) =>
        line.includes("OPERATION_FAILED") &&
        line.includes("unexpected reader failure"),
    ),
  ).toBe(true);
  expect(started.logs.join("")).not.toContain(headers.authorization);
});
