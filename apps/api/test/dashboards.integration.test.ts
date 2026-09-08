import {
  startTraceDatabase,
  traceEnvironment,
} from "../../../packages/traces/test/support.js";
import { z } from "zod";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  dashboardListOutputSchema,
  dashboardProfileSchema,
} from "@agentcommons/core";
import {
  provisionOrganization,
  provisionMember,
  testAuthConfiguration,
} from "./support.js";
import { createRuntime } from "../src/main.js";
import { createApp } from "../src/app.js";
import { environment } from "../src/env.js";
import { cleanup } from "../../../scripts/cleanup.js";

let db: Awaited<ReturnType<typeof startTraceDatabase>>;
let first: Awaited<ReturnType<typeof provisionOrganization>>;
let second: typeof first;
let member: Awaited<ReturnType<typeof provisionMember>>;
let runtime: Awaited<ReturnType<typeof createRuntime>>;
let app: Awaited<ReturnType<typeof createApp>>;
let address: string;
const release: Array<() => Promise<unknown>> = [];
const definition = {
  version: 1,
  widgets: [
    {
      id: "sessions",
      title: "Sessions",
      sql: "SELECT count(*) AS value FROM sessions",
      display: "number",
      unit: "count",
    },
  ],
};
const headers = (account = first) => ({
  authorization: `Bearer ${account.key}`,
  "Content-Type": "application/json",
});
async function save(value: unknown, account = first) {
  return fetch(`${address}/api/v1/me/dashboards`, {
    method: "POST",
    headers: headers(account),
    body: JSON.stringify(value),
  });
}
async function list(account = first) {
  const response = await fetch(`${address}/api/v1/me/dashboards`, {
    headers: headers(account),
  });
  expect(response.status).toBe(200);
  return dashboardListOutputSchema.parse(await response.json());
}
beforeAll(async () => {
  db = await startTraceDatabase();
  release.unshift(() => db.close());
  first = await provisionOrganization(db, "dashboard-first");
  second = await provisionOrganization(db, "dashboard-second");
  member = await provisionMember(
    db,
    first.owner,
    "dashboard-member@example.com",
  );
  const env = environment({
    ...traceEnvironment(db.traceConfig),
    PUBLIC_URL: testAuthConfiguration.publicUrl,
    BETTER_AUTH_SECRET: testAuthConfiguration.secret,
    DATABASE_URL: db.urls.app,
    LOG_LEVEL: "silent",
    EMBEDDINGS_ENABLED: "false",
  });
  runtime = await createRuntime(env);
  release.unshift(() => runtime.close());
  app = await createApp({ env, services: runtime.services, static: false });
  release.unshift(() => app.close());
  address = await app.listen({ host: "127.0.0.1", port: 0 });
});
afterAll(async () => {
  expect(await cleanup(release.splice(0))).toEqual([]);
});

// @req R-DASH-25
it("persists declarations and exposes one generated schema, while enforcing owner and organization isolation", async () => {
  const response = await save({ name: "My adoption", definition });
  expect(response.status).toBe(200);
  const value = dashboardProfileSchema.parse(await response.json());
  expect(value.definition).toEqual(definition);
  expect((await list()).items).toContainEqual(value);
  expect((await list(member)).items).toEqual([]);
  expect((await list(second)).items).toEqual([]);
  expect((await list()).definition_schema).toMatchObject({
    type: "object",
    properties: { widgets: { maxItems: 12 } },
  });
  for (const other of [member, second]) {
    expect(
      (
        await save(
          { id: value.id, revision: 0, name: "Hijack", definition },
          other,
        )
      ).status,
    ).toBe(404);
    const deleted = await fetch(`${address}/api/v1/me/dashboards/${value.id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${other.key}` },
    });
    expect(deleted.status, await deleted.clone().text()).toBe(200);
    expect(await deleted.json()).toEqual({ deleted: false });
  }
  expect((await list()).items).toContainEqual(value);
});

// @req R-DASH-25
it("prevents concurrent lost updates, rejects invalid definitions/SQL and atomically rolls back when auditing fails", async () => {
  const created = dashboardProfileSchema.parse(
    await (await save({ name: "Concurrency", definition })).json(),
  );
  const updates = await Promise.all(
    ["First", "Second"].map((name) =>
      save({ id: created.id, revision: created.revision, name, definition }),
    ),
  );
  expect(updates.map((item) => item.status).sort()).toEqual([200, 409]);
  expect(
    (
      await save({
        name: "Bad SQL",
        definition: {
          ...definition,
          widgets: [{ ...definition.widgets[0], sql: "DELETE FROM sessions" }],
        },
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await save({
        name: "Duplicate",
        definition: {
          ...definition,
          widgets: [...definition.widgets, ...definition.widgets],
        },
      })
    ).status,
  ).toBe(400);
  const original = runtime.services.audit.write.bind(runtime.services.audit);
  const spy = vi
    .spyOn(runtime.services.audit, "write")
    .mockImplementation(async (context, operation, tx) => {
      if (operation.action === "dashboard.save")
        throw new Error("Unavailable audit storage");
      return original(context, operation, tx);
    });
  try {
    expect(
      (await save({ name: "Must roll back", definition })).status,
    ).toBeGreaterThanOrEqual(500);
  } finally {
    spy.mockRestore();
  }
  expect(
    (await list()).items.some((item) => item.name === "Must roll back"),
  ).toBe(false);
});

// @req R-DASH-25 @req R-RED-08
it("redacts every persisted free-text path and never persists query results", async () => {
  const secret = `sk-ant-${"a".repeat(48)}`;
  const response = await save({
    name: secret,
    definition: {
      ...definition,
      widgets: [
        {
          ...definition.widgets[0],
          title: secret,
          sql: `SELECT '${secret}' AS value`,
        },
      ],
    },
  });
  expect(response.status).toBe(200);
  const profile = dashboardProfileSchema.parse(await response.json());
  const row = await db.prisma.dashboardProfile.findUnique({
    where: { id: profile.id },
  });
  expect(JSON.stringify(row)).not.toContain(secret);
  expect(JSON.stringify(row)).toContain("REDACTED");
  expect(row?.definition).not.toHaveProperty("results");
});

// @req R-DASH-25
it("shares native MCP/REST preferences with truthful mutation annotations and exactly one audit per call", async () => {
  const client = new Client({ name: "dashboard-test", version: "1" });
  const transport = new StreamableHTTPClientTransport(
    new URL(`${address}/mcp`),
    { requestInit: { headers: headers(member) } },
  );
  await client.connect(transport as Transport);
  try {
    const tools = (await client.listTools()).tools;
    expect(
      tools.find((tool) => tool.name === "dashboard_save")?.annotations
        ?.readOnlyHint,
    ).toBe(false);
    const before = await db.prisma.auditEvent.count({
      where: {
        action: "dashboard.save",
        userId: z.string().parse(member.context.caller?.userId),
      },
    });
    const result = await client.callTool({
      name: "dashboard_save",
      arguments: { name: "Agent chart", definition },
    });
    expect(result.isError).not.toBe(true);
    const profile = dashboardProfileSchema.parse(result.structuredContent);
    expect((await list(member)).items).toContainEqual(profile);
    const after = await db.prisma.auditEvent.count({
      where: {
        action: "dashboard.save",
        userId: z.string().parse(member.context.caller?.userId),
      },
    });
    expect(after - before).toBe(1);
    const removed = await client.callTool({
      name: "dashboard_delete",
      arguments: { id: profile.id },
    });
    expect(removed.structuredContent).toEqual({ deleted: true });
    expect((await list(member)).items).toEqual([]);
  } finally {
    await client.close();
  }
});
