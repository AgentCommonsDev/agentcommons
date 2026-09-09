import {
  startTraceDatabase,
  traceEnvironment,
  waitForTracePublication,
} from "../../../packages/traces/test/support.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  builtinDashboardId,
  builtinDashboardIds,
  dashboardListOutputSchema,
  dashboardRenderOutputSchema,
  dashboardSchema,
  type DashboardDefinition,
  type DashboardTile,
} from "@agentcommons/core";
import {
  dashboardTileTemplates,
  standardDashboardVariables,
  teamActivityDashboard,
  teamOverviewDashboard,
} from "@agentcommons/core/dashboards";
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
let other: typeof member;
let runtime: Awaited<ReturnType<typeof createRuntime>>;
let app: Awaited<ReturnType<typeof createApp>>;
let address: string;
const release: Array<() => Promise<unknown>> = [];
type Account = { key: string };
type Ingester = Awaited<ReturnType<typeof provisionMember>>;

function template(id: string, layout: DashboardTile["layout"]): DashboardTile {
  const entry = dashboardTileTemplates.find((item) => item.id === id);
  if (!entry) throw new Error(`Missing template ${id}`);
  return { ...entry.tile, layout };
}
const definition: DashboardDefinition = {
  version: 2,
  variables: standardDashboardVariables,
  tiles: [
    template("captured_sessions", { x: 0, y: 0, w: 3, h: 2 }),
    template("sessions_per_day", { x: 0, y: 2, w: 8, h: 5 }),
    template("recent_sessions", { x: 0, y: 7, w: 12, h: 6 }),
  ],
};
const headers = (account: Account) => ({
  authorization: `Bearer ${account.key}`,
});
async function request(
  path: string,
  account: Account,
  init: { method?: string; body?: unknown } = {},
) {
  return fetch(`${address}/api/v1${path}`, {
    method: init.method ?? "GET",
    headers:
      init.body === undefined
        ? headers(account)
        : { ...headers(account), "Content-Type": "application/json" },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
}
async function list(account: Account) {
  const response = await request("/dashboards", account);
  expect(response.status).toBe(200);
  return dashboardListOutputSchema.parse(await response.json());
}
async function render(account: Account, body: unknown) {
  const response = await request("/dashboards/render", account, {
    method: "POST",
    body,
  });
  expect(response.status, await response.clone().text()).toBe(200);
  return dashboardRenderOutputSchema.parse(await response.json());
}
function tileValue(
  output: z.infer<typeof dashboardRenderOutputSchema>,
  id: string,
) {
  const tile = output.tiles.find((item) => item.id === id);
  expect(tile?.error, id).toBeNull();
  const value = tile?.result?.rows[0]?.[0];
  return typeof value === "number" ? String(value) : z.string().parse(value);
}
/** ClickHouse returns 64-bit integers as strings; compare cells numerically. */
const num = (value: unknown) =>
  Number(z.union([z.number(), z.string()]).parse(value));
/** Rows of a table or chart tile as objects keyed by column name. */
function tileRows(
  output: z.infer<typeof dashboardRenderOutputSchema>,
  id: string,
): Record<string, unknown>[] {
  const tile = output.tiles.find((item) => item.id === id);
  expect(tile?.error, id).toBeNull();
  const result = tile?.result;
  if (!result) throw new Error(`Tile ${id} returned no result`);
  return result.rows.map((row) =>
    Object.fromEntries(
      result.columns.map((column, index) => [column.name, row[index]]),
    ),
  );
}
async function ingestSession(remoteUrl: string, by: Ingester = first) {
  const records = [
    {
      type: "user",
      uuid: `user-${randomUUID()}`,
      timestamp: new Date().toISOString(),
      message: {
        content: [
          { type: "text", text: "Dashboard fixture: verify tile queries." },
        ],
      },
    },
    {
      type: "assistant",
      uuid: `assistant-${randomUUID()}`,
      timestamp: new Date().toISOString(),
      message: {
        model: "fixture-model",
        content: [
          { type: "text", text: "Reading the upload module." },
          {
            type: "tool_use",
            id: `tool-${randomUUID()}`,
            name: "Read",
            input: { file_path: "/repo/src/upload.ts" },
          },
        ],
      },
    },
  ];
  const result = await runtime.services.ingest.execute(by.context, {
    envelopeVersion: 2,
    hook: { sha256: "a".repeat(64), extensionSha256: null },
    harness: "CLAUDE_CODE",
    harnessSessionId: randomUUID(),
    behavior: "end",
    nativeEvent: "SessionEnd",
    batchId: randomUUID(),
    installationId: randomUUID(),
    sentAt: new Date().toISOString(),
    sourcePos: records.length - 1,
    context: {
      cwd: "/repo",
      installation: {
        hostname: "dashboard-fixture",
        osUser: "developer",
        platform: "linux",
        arch: "x64",
      },
      git: { root: "/repo", remoteUrl, branch: "main", head: "abc123" },
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
  });
  const sessionId = z
    .object({ sessionId: z.uuid() })
    .parse(result.result).sessionId;
  await waitForTracePublication(db.prisma, [sessionId]);
  return sessionId;
}
async function mcpClient(account: Account) {
  const client = new Client({ name: "dashboard-test", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${address}/mcp`), {
      requestInit: { headers: headers(account) },
    }) as Transport,
  );
  release.unshift(() => client.close());
  return client;
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
  other = await provisionMember(db, first.owner, "dashboard-other@example.com");
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
  await runtime.jobs.start();
  app = await createApp({ env, services: runtime.services, static: false });
  release.unshift(() => app.close());
  address = await app.listen({ host: "127.0.0.1", port: 0 });
});
afterAll(async () => {
  expect(await cleanup(release.splice(0))).toEqual([]);
});

// @req R-DASH-15 @req R-DASH-16 @req R-DASH-25
it("ships the built-in Team overview as the default and renders its tiles with typed time and repository variables over real trace data", async () => {
  await ingestSession("git@github.com:acme/app.git");
  const listed = await list(member);
  expect(listed.default_id).toBe(builtinDashboardId);
  expect(listed.items[0]).toMatchObject({
    id: builtinDashboardId,
    builtin: true,
    is_default: true,
    can_edit: false,
    name: "Team overview",
  });
  expect(listed.templates.length).toBeGreaterThan(8);
  expect(listed.definition_schema).toMatchObject({
    type: "object",
    properties: { tiles: { maxItems: 24 } },
  });
  const builtin = dashboardSchema.parse(
    await (await request(`/dashboards/${builtinDashboardId}`, member)).json(),
  );
  expect(builtin.definition.tiles).toHaveLength(10);
  expect(builtin.definition.tiles.map((tile) => tile.type).sort()).toEqual([
    "chart",
    "chart",
    "chart",
    "chart",
    "stat",
    "stat",
    "stat",
    "stat",
    "table",
    "table",
  ]);

  const everything = await render(member, {
    id: builtinDashboardId,
    variables: { time_range: "7d" },
  });
  expect(everything.tiles.filter((tile) => tile.error !== null)).toEqual([]);
  expect(everything.tiles).toHaveLength(10);
  expect(tileValue(everything, "captured_sessions")).toBe("1");
  expect(everything.variables.time_range).toMatchObject({
    from: expect.stringMatching(/T00:00:00\.000Z$/) as unknown,
  });
  expect(everything.variables.repo).toEqual([]);

  const scoped = await render(member, {
    id: builtinDashboardId,
    tiles: ["captured_sessions"],
    variables: { time_range: "30d", repo: ["github.com/acme/app"] },
  });
  expect(scoped.tiles).toHaveLength(1);
  expect(tileValue(scoped, "captured_sessions")).toBe("1");
  const elsewhere = await render(member, {
    id: builtinDashboardId,
    tiles: ["captured_sessions"],
    variables: { repo: ["github.com/other/tool"] },
  });
  expect(tileValue(elsewhere, "captured_sessions")).toBe("0");
  const past = await render(member, {
    id: builtinDashboardId,
    tiles: ["captured_sessions"],
    variables: {
      time_range: {
        from: "2001-01-01T00:00:00.000Z",
        to: "2001-02-01T00:00:00.000Z",
      },
    },
  });
  expect(tileValue(past, "captured_sessions")).toBe("0");

  expect(
    (
      await request("/dashboards/render", member, {
        method: "POST",
        body: { id: builtinDashboardId, tiles: ["missing_tile"] },
      })
    ).status,
  ).toBe(400);
  const inline = await render(member, {
    definition: {
      version: 2,
      tiles: [
        {
          id: "undeclared",
          type: "stat",
          title: "Undeclared parameter",
          layout: { x: 0, y: 0, w: 3, h: 2 },
          sql: "SELECT count() AS value FROM sessions WHERE started_at >= {since:DateTime}",
          unit: "count",
        },
        {
          id: "fine",
          type: "stat",
          title: "Fine",
          layout: { x: 3, y: 0, w: 3, h: 2 },
          sql: "SELECT count() AS value FROM sessions",
          unit: "count",
        },
      ],
    },
  });
  expect(inline.tiles.map((tile) => tile.error?.code ?? null)).toEqual([
    "SQL_REJECTED",
    null,
  ]);
  expect(inline.tiles[0]?.error?.message).toContain("not declared");
  expect(tileValue(inline, "fine")).toBe("1");
});

// @req R-DASH-25 @req R-DASH-29 @req R-RED-08
it("saves organization-visible dashboards with creator/admin editing, revision conflicts, guard errors, defaults, redaction and MCP tools", async () => {
  const created = await request("/dashboards", member, {
    method: "POST",
    body: { name: "Reuse focus", description: "Member view", definition },
  });
  expect(created.status, await created.clone().text()).toBe(200);
  const saved = dashboardSchema.parse(await created.json());
  expect(saved).toMatchObject({
    name: "Reuse focus",
    revision: 0,
    builtin: false,
    is_default: false,
    can_edit: true,
    tile_count: 3,
    created_by: { user_id: member.owner.caller?.userId },
  });
  expect(saved.definition).toEqual(definition);

  const seenByOther = (await list(other)).items.find(
    (item) => item.id === saved.id,
  );
  expect(seenByOther).toMatchObject({ can_edit: false });
  expect((await list(second)).items.map((item) => item.id)).toEqual([
    builtinDashboardId,
    builtinDashboardIds.teamActivity,
  ]);
  expect((await request(`/dashboards/${saved.id}`, second)).status).toBe(404);
  const update = (account: Account, revision: number, name: string) =>
    request("/dashboards", account, {
      method: "POST",
      body: { id: saved.id, revision, name, definition },
    });
  expect((await update(other, 0, "Hijack")).status).toBe(403);
  expect(
    (await request(`/dashboards/${saved.id}`, other, { method: "DELETE" }))
      .status,
  ).toBe(403);
  expect((await update(first, 5, "Stale")).status).toBe(409);
  const byAdmin = dashboardSchema.parse(
    await (await update(first, 0, "Renamed by admin")).json(),
  );
  expect(byAdmin).toMatchObject({ revision: 1, can_edit: true });
  const byCreator = dashboardSchema.parse(
    await (await update(member, 1, "Renamed by creator")).json(),
  );
  expect(byCreator.revision).toBe(2);

  const setDefault = (account: Account, id: string) =>
    request(`/dashboards/${id}/default`, account, { method: "POST", body: {} });
  expect((await setDefault(member, saved.id)).status).toBe(403);
  expect(await (await setDefault(first, saved.id)).json()).toEqual({
    default_id: saved.id,
  });
  const defaulted = await list(other);
  expect(defaulted.default_id).toBe(saved.id);
  expect(defaulted.items.map((item) => [item.id, item.is_default])).toEqual([
    [builtinDashboardId, false],
    [builtinDashboardIds.teamActivity, false],
    [saved.id, true],
  ]);
  expect(await (await setDefault(first, builtinDashboardId)).json()).toEqual({
    default_id: builtinDashboardId,
  });
  expect((await list(member)).default_id).toBe(builtinDashboardId);

  expect(
    (
      await request("/dashboards", member, {
        method: "POST",
        body: {
          id: builtinDashboardId,
          revision: 0,
          name: "Overwrite",
          definition,
        },
      })
    ).status,
  ).toBe(409);
  const badSql = await request("/dashboards", member, {
    method: "POST",
    body: {
      name: "Bad SQL",
      definition: {
        ...definition,
        tiles: [{ ...definition.tiles[0], sql: "DELETE FROM sessions" }],
      },
    },
  });
  expect(badSql.status).toBe(400);
  expect(
    z.object({ message: z.string() }).parse(await badSql.json()).message,
  ).toContain('Tile "captured_sessions"');
  const undeclared = await request("/dashboards", member, {
    method: "POST",
    body: {
      name: "Undeclared",
      definition: { ...definition, variables: [] },
    },
  });
  expect(undeclared.status).toBe(400);
  expect(await undeclared.text()).toContain("not declared");

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
      (
        await request("/dashboards", member, {
          method: "POST",
          body: { name: "Must roll back", definition },
        })
      ).status,
    ).toBeGreaterThanOrEqual(500);
  } finally {
    spy.mockRestore();
  }
  expect(
    (await list(member)).items.some((item) => item.name === "Must roll back"),
  ).toBe(false);

  const secret = `sk-ant-${"a".repeat(48)}`;
  const redacted = dashboardSchema.parse(
    await (
      await request("/dashboards", member, {
        method: "POST",
        body: {
          name: secret,
          description: secret,
          definition: {
            ...definition,
            tiles: [
              {
                ...definition.tiles[0],
                title: secret,
                sql: `SELECT '${secret}' AS value`,
              },
            ],
          },
        },
      })
    ).json(),
  );
  const row = await db.prisma.dashboard.findUnique({
    where: { id: redacted.id },
  });
  expect(JSON.stringify(row)).not.toContain(secret);
  expect(JSON.stringify(row)).toContain("REDACTED");

  const client = await mcpClient(member);
  const tools = (await client.listTools()).tools;
  expect(
    tools
      .filter((tool) => tool.name.startsWith("dashboard_"))
      .map((tool) => [
        tool.name,
        tool.annotations?.readOnlyHint,
        tool.annotations?.destructiveHint,
      ]),
  ).toEqual([
    ["dashboard_list", true, false],
    ["dashboard_get", true, false],
    ["dashboard_render", true, false],
    ["dashboard_save", false, false],
    ["dashboard_delete", false, true],
  ]);
  const rendered = await client.callTool({
    name: "dashboard_render",
    arguments: {
      definition,
      variables: { time_range: "90d" },
      tiles: ["captured_sessions"],
    },
  });
  expect(rendered.isError).not.toBe(true);
  expect(
    tileValue(
      dashboardRenderOutputSchema.parse(rendered.structuredContent),
      "captured_sessions",
    ),
  ).toBe("1");
  const fetched = await client.callTool({
    name: "dashboard_get",
    arguments: { id: saved.id },
  });
  expect(dashboardSchema.parse(fetched.structuredContent).name).toBe(
    "Renamed by creator",
  );
  expect(
    (
      await client.callTool({
        name: "dashboard_set_default",
        arguments: { id: saved.id },
      })
    ).isError,
  ).toBe(true);
  const adminClient = await mcpClient(first);
  expect(
    (await adminClient.listTools()).tools.map((tool) => tool.name),
  ).toContain("dashboard_set_default");
  const promoted = await adminClient.callTool({
    name: "dashboard_set_default",
    arguments: { id: saved.id },
  });
  expect(promoted.structuredContent).toEqual({ default_id: saved.id });
  const removed = await client.callTool({
    name: "dashboard_delete",
    arguments: { id: saved.id },
  });
  expect(removed.structuredContent).toEqual({ deleted: true });
  expect((await list(member)).default_id).toBe(builtinDashboardId);
  expect((await request(`/dashboards/${saved.id}`, member)).status).toBe(404);
});

// @req R-DASH-32
it("serves saved dashboard renders from the cache while the organization's data is unchanged, per caller scope, re-runs on refresh or new data, and never caches inline definitions", async () => {
  const body = { id: builtinDashboardId, variables: { time_range: "30d" } };
  const initial = await render(member, body);
  expect(initial.cached, "first render").toBe(false);
  const second = await render(member, body);
  expect(second.cached, "same scope, unchanged data").toBe(true);
  expect(second.rendered_at).toBe(initial.rendered_at);
  expect(second.tiles).toEqual(initial.tiles);
  // Another member has their own scope: private sessions differ per user.
  const otherScope = await render(other, body);
  expect(otherScope.cached, "other member scope").toBe(false);
  // Admins share one entry among themselves but not with members.
  const admin = await render(first, body);
  expect(admin.cached, "admin scope").toBe(false);
  expect((await render(first, body)).cached, "admin hit").toBe(true);
  // Different variables or a tile subset are separate entries (an earlier test may
  // already have warmed them, so compare the runs rather than the cached flag).
  const weekly = await render(member, {
    ...body,
    variables: { time_range: "7d" },
  });
  expect(weekly.rendered_at, "other variables").not.toBe(second.rendered_at);
  const subset = await render(member, {
    ...body,
    tiles: ["captured_sessions"],
  });
  expect(
    subset.tiles.map((tile) => tile.id),
    "tile subset",
  ).toEqual(["captured_sessions"]);
  expect(subset.rendered_at, "tile subset run").not.toBe(second.rendered_at);
  // refresh re-runs and replaces the entry.
  const refreshed = await render(member, { ...body, refresh: true });
  expect(refreshed.cached, "refresh").toBe(false);
  expect(refreshed.rendered_at >= initial.rendered_at).toBe(true);
  expect((await render(member, body)).rendered_at).toBe(refreshed.rendered_at);
  // New data (a publication) changes the organization's data version and misses.
  await ingestSession("https://github.com/rek7/agentcommons-cache.git");
  expect((await render(member, body)).cached, "after new data").toBe(false);
  // Inline definitions are never cached.
  const inline = {
    definition: teamOverviewDashboard.definition,
    variables: {},
  };
  expect((await render(member, inline)).cached, "inline 1").toBe(false);
  expect((await render(member, inline)).cached, "inline 2").toBe(false);
});

// @req R-DASH-25
it("ships the built-in Team activity as a second read-only, non-default dashboard and renders every per-person tile over real trace data", async () => {
  const activityId = builtinDashboardIds.teamActivity;
  const memberUser = await db.prisma.user.findUniqueOrThrow({
    where: { email: member.email },
  });
  const memberPerson = memberUser.name || member.email;
  // The member works in two repositories; the owner's sessions come from earlier tests.
  await ingestSession("git@github.com:acme/app.git", member);
  await ingestSession("git@github.com:acme/app.git", member);
  await ingestSession("https://github.com/acme/tools.git", member);

  const listed = await list(member);
  expect(listed.default_id).toBe(builtinDashboardId);
  expect(
    listed.items
      .filter((item) => item.builtin)
      .map((item) => [item.id, item.name, item.is_default, item.can_edit]),
  ).toEqual([
    [builtinDashboardId, "Team overview", true, false],
    [activityId, "Team activity", false, false],
  ]);
  expect(listed.items[1]).toMatchObject({
    tile_count: 10,
    created_by: null,
    revision: 0,
    description: expect.stringContaining("per person") as unknown,
  });
  const fetched = dashboardSchema.parse(
    await (await request(`/dashboards/${activityId}`, member)).json(),
  );
  expect(fetched.definition).toEqual(teamActivityDashboard.definition);
  expect(fetched.definition.tiles.map((tile) => tile.type)).toEqual([
    "stat",
    "stat",
    "stat",
    "stat",
    "chart",
    "table",
    "chart",
    "chart",
    "table",
    "chart",
  ]);

  const rendered = await render(member, {
    id: activityId,
    variables: { time_range: "30d" },
  });
  expect(
    rendered.tiles.map((tile) => [tile.id, tile.error]),
    JSON.stringify(rendered.tiles.filter((tile) => tile.error !== null)),
  ).toEqual(
    teamActivityDashboard.definition.tiles.map((tile) => [tile.id, null]),
  );
  expect(rendered.cached).toBe(false);
  const total = Number(tileValue(rendered, "captured_sessions"));
  expect(total).toBeGreaterThanOrEqual(5);
  expect(tileValue(rendered, "active_people")).toBe("2");
  expect(Number(tileValue(rendered, "messages_total"))).toBeGreaterThanOrEqual(
    total * 2,
  );
  expect(Number(tileValue(rendered, "tool_calls_total"))).toBe(total);

  const perPerson = tileRows(rendered, "sessions_per_person");
  expect(perPerson).toHaveLength(2);
  expect(perPerson[0]?.person).toBe(memberPerson);
  expect(num(perPerson[0]?.sessions)).toBe(3);
  expect(num(perPerson[1]?.sessions)).toBe(total - 3);
  const ownerPerson = z.string().parse(perPerson[1]?.person);
  expect(ownerPerson).not.toBe(memberPerson);

  const activity = tileRows(rendered, "activity_per_person");
  expect(activity.map((row) => row.person)).toEqual([
    memberPerson,
    ownerPerson,
  ]);
  expect(
    ["sessions", "tool_calls", "repositories"].map((column) =>
      num(activity[0]?.[column]),
    ),
  ).toEqual([3, 3, 2]);
  expect(num(activity[0]?.messages)).toBeGreaterThanOrEqual(6);
  expect(num(activity[0]?.tokens)).toBeGreaterThanOrEqual(0);
  expect(z.string().parse(activity[0]?.last_active)).toMatch(/^20\d\d-/);

  const daily = tileRows(rendered, "sessions_per_day_by_person");
  expect(daily.reduce((sum, row) => sum + num(row.sessions), 0)).toBe(total);
  expect(new Set(daily.map((row) => row.person))).toEqual(
    new Set([memberPerson, ownerPerson]),
  );

  const repos = tileRows(rendered, "repos_per_person");
  expect(
    repos
      .filter((row) => row.person === memberPerson)
      .map((row) => [row.repo_name, num(row.sessions)]),
  ).toEqual([
    ["github.com/acme/app", 2],
    ["github.com/acme/tools", 1],
  ]);
  expect(repos.every((row) => typeof row.last_session === "string")).toBe(true);

  const durations = tileRows(rendered, "duration_per_person");
  expect(durations).toHaveLength(2);
  for (const row of durations)
    expect(num(row.avg_seconds)).toBeGreaterThanOrEqual(0);

  const harnesses = tileRows(rendered, "harness_per_person");
  expect(
    harnesses.map((row) => [row.person, row.harness, num(row.sessions)]),
  ).toEqual([
    [memberPerson, "CLAUDE_CODE", 3],
    [ownerPerson, "CLAUDE_CODE", total - 3],
  ]);

  // Variables narrow every tile: one repository, one person.
  const scoped = await render(member, {
    id: activityId,
    tiles: ["active_people", "sessions_per_person", "repos_per_person"],
    variables: { time_range: "30d", repo: ["github.com/acme/tools"] },
  });
  expect(tileValue(scoped, "active_people")).toBe("1");
  expect(
    tileRows(scoped, "sessions_per_person").map((row) => [
      row.person,
      num(row.sessions),
    ]),
  ).toEqual([[memberPerson, 1]]);
  expect(tileRows(scoped, "repos_per_person")).toHaveLength(1);
  // Built-ins render through the same cache as saved dashboards.
  expect(
    (await render(member, { id: activityId, variables: { time_range: "30d" } }))
      .cached,
  ).toBe(true);

  // Read-only: no save, delete or Home default (the shipped default is the only built-in default).
  expect(
    (
      await request("/dashboards", member, {
        method: "POST",
        body: {
          id: activityId,
          revision: 0,
          name: "Overwrite",
          definition: teamOverviewDashboard.definition,
        },
      })
    ).status,
  ).toBe(409);
  expect(
    (await request(`/dashboards/${activityId}`, first, { method: "DELETE" }))
      .status,
  ).toBe(409);
  const promoted = await request(`/dashboards/${activityId}/default`, first, {
    method: "POST",
    body: {},
  });
  expect(promoted.status).toBe(409);
  expect(await promoted.text()).toContain(
    "Team activity cannot be the Home default",
  );
  expect((await list(member)).default_id).toBe(builtinDashboardId);

  const client = await mcpClient(member);
  const viaMcp = await client.callTool({
    name: "dashboard_render",
    arguments: {
      id: activityId,
      tiles: ["active_people"],
      variables: { time_range: "30d" },
    },
  });
  expect(viaMcp.isError).not.toBe(true);
  expect(
    tileValue(
      dashboardRenderOutputSchema.parse(viaMcp.structuredContent),
      "active_people",
    ),
  ).toBe("2");
  const described = (await client.listTools()).tools.find(
    (tool) => tool.name === "dashboard_list",
  );
  expect(described?.description).toContain("Team activity");
});
