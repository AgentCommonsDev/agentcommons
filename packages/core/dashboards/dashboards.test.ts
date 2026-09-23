import { expect, it } from "vitest";
import { z } from "zod";
import {
  builtinDashboardId,
  builtinDashboardIds,
  dashboardDefinitionSchema,
  dashboardDefinitionToolSchema,
  dashboardRenderInputSchema,
  dashboardRenderToolInputSchema,
  dashboardSaveToolInputSchema,
} from "../schemas/dashboards.js";
import { guardTraceSql, TraceSqlError } from "../sql.js";
import {
  builtinDashboard,
  builtinDashboards,
  dashboardParameterTypes,
  dashboardScopeSql,
  dashboardTileTemplates,
  resolveDashboardVariables,
  standardDashboardVariables,
  teamActivityDashboard,
  teamOverviewDashboard,
} from "./index.js";

// @req R-DASH-25
it("ships two valid built-in dashboards whose tile queries pass the guard with their declared parameters", () => {
  expect(
    builtinDashboards.map((dashboard) => [dashboard.id, dashboard.name]),
  ).toEqual([
    [builtinDashboardIds.teamOverview, "Team overview"],
    [builtinDashboardIds.teamActivity, "Team activity"],
  ]);
  expect(builtinDashboard(builtinDashboardId)).toBe(teamOverviewDashboard);
  expect(teamOverviewDashboard.id).toBe(builtinDashboardId);
  expect(builtinDashboard(builtinDashboardIds.teamActivity)).toBe(
    teamActivityDashboard,
  );
  expect(
    builtinDashboard("00000000-0000-4000-8000-000000000009"),
  ).toBeUndefined();
  expect(teamActivityDashboard.definition.tiles.map((tile) => tile.id)).toEqual(
    [
      "active_people",
      "captured_sessions",
      "messages_total",
      "tool_calls_total",
      "tokens_per_person",
      "activity_per_person",
      "sessions_per_day_by_person",
      "harness_per_person",
      "repos_per_person",
      "duration_per_person",
    ],
  );
  for (const dashboard of builtinDashboards) {
    expect(
      dashboardDefinitionSchema.safeParse(dashboard.definition).success,
      dashboard.name,
    ).toBe(true);
    const types = dashboardParameterTypes(dashboard.definition.variables);
    expect(types, dashboard.name).toEqual({
      time_range_from: "DateTime",
      time_range_to: "DateTime",
      repo: "Array(String)",
    });
    for (const tile of dashboard.definition.tiles)
      if ("sql" in tile)
        expect(
          guardTraceSql(tile.sql, false, types),
          `${dashboard.name}/${tile.id}`,
        ).toContain("SELECT");
  }
  for (const template of dashboardTileTemplates)
    if ("sql" in template.tile)
      expect(
        guardTraceSql(
          template.tile.sql,
          false,
          dashboardParameterTypes(template.variables),
        ),
        template.id,
      ).toContain("SELECT");
});

// @req R-DASH-47
it("counts and lists root sessions only, as the Sessions list does, while message, tool-call and token sums cover every session", () => {
  const roots = "parent_session_id IS NULL";
  expect(dashboardScopeSql.rootScope).toBe(
    `${dashboardScopeSql.scope} AND ${roots}`,
  );
  const sql = (id: string): string => {
    const tile = dashboardTileTemplates.find((item) => item.id === id)?.tile;
    if (!tile || !("sql" in tile)) throw new Error(`Missing SQL tile ${id}`);
    return tile.sql;
  };
  // Every tile whose rows or counts are sessions: one row or one count per root.
  for (const id of [
    "captured_sessions",
    "search_sessions",
    "reuse_sessions",
    "reuse_rate",
    "sessions_per_day",
    "harness_share",
    "top_repos",
    "most_reused",
    "recent_sessions",
    "sessions_per_person",
    "sessions_per_day_by_person",
    "repos_per_person",
    "duration_per_person",
    "harness_per_person",
  ])
    expect(sql(id), id).toContain(` AND ${roots}`);
  expect(sql("top_tools")).toContain(" AND s.parent_session_id IS NULL");
  // The per-person table mixes both: root sessions, activity over every session.
  expect(sql("activity_per_person")).toContain(`countIf(${roots}) AS sessions`);
  expect(sql("activity_per_person")).not.toContain(` AND ${roots}`);
  // Totals stay totals: a subagent run's messages, tool calls and tokens are real work.
  for (const id of [
    "messages_total",
    "tool_calls_total",
    "tokens_per_person",
    "active_people",
  ])
    expect(sql(id), id).not.toContain("parent_session_id");
  // The reuse trend buckets the same scanned view as the Reuse rate stat tile, so it carries
  // the window, repository and root-session scope rather than the unscoped weekly view.
  expect(sql("reuse_trend")).toContain("metrics_reuse_sessions");
  expect(sql("reuse_trend")).toContain("time_range_to");
  expect(sql("reuse_trend")).toContain("parent_session_id IS NULL");
});

// @req R-DASH-48
it("offers a reuse-versus-outcome tile that compares three disjoint cohorts over roots", () => {
  const tile = dashboardTileTemplates.find(
    (item) => item.id === "reuse_outcomes",
  )?.tile;
  if (!tile || !("sql" in tile)) throw new Error("Missing reuse_outcomes tile");
  // Reads the joined reuse-and-outcome view, roots only, so a subagent counts inside its root.
  expect(tile.sql).toContain("FROM metrics_reuse_outcomes");
  expect(tile.sql).toContain("parent_session_id IS NULL");
  // Three disjoint cohorts: no reuse, same-user reuse, cross-user reuse.
  expect(tile.sql).toContain(
    "multiIf(reused = 0, 'No reuse', cross_user_reused = 1, 'Cross-user reuse', 'Same-user reuse') AS cohort",
  );
  // Member-safe effort and completion signals only; the admin-only rerun loop stays off the
  // shared tile and is sliced through the sql tool instead.
  expect(tile.sql).not.toContain("rerun_loop");
  expect(
    guardTraceSql(
      tile.sql,
      false,
      dashboardParameterTypes(standardDashboardVariables),
    ),
  ).toContain("metrics_reuse_outcomes");
});

// @req R-DASH-25 @req R-SQL-02
it("rejects undeclared or mistyped parameters and definitions with duplicate ids or dangling controls", () => {
  const types = dashboardParameterTypes(standardDashboardVariables);
  expect(() => guardTraceSql("SELECT {other:String}", false, types)).toThrow(
    TraceSqlError,
  );
  expect(() =>
    guardTraceSql("SELECT {time_range_from:String}", false, types),
  ).toThrow("must use the type DateTime");
  expect(
    guardTraceSql("SELECT {time_range_from: DateTime }", false, types),
  ).toContain("time_range_from");
  // Every per-person tile needs the declared variables: without them the guard refuses.
  for (const tile of teamActivityDashboard.definition.tiles)
    if ("sql" in tile)
      expect(() => guardTraceSql(tile.sql, false, {}), tile.id).toThrow(
        "not declared",
      );
  const tile = teamOverviewDashboard.definition.tiles[0];
  expect(
    dashboardDefinitionSchema.safeParse({
      version: 2,
      tiles: [tile, tile],
    }).success,
  ).toBe(false);
  expect(
    dashboardDefinitionSchema.safeParse({
      version: 2,
      tiles: [
        {
          id: "picker",
          type: "control",
          title: "Range",
          layout: { x: 0, y: 0, w: 3, h: 2 },
          variable: "missing",
        },
      ],
    }).success,
  ).toBe(false);
  expect(
    dashboardDefinitionSchema.safeParse({
      version: 2,
      tiles: [{ ...tile, layout: { x: 10, y: 0, w: 4, h: 2 } }],
    }).success,
  ).toBe(false);
  expect(dashboardRenderInputSchema.safeParse({ variables: {} }).success).toBe(
    false,
  );
});

// @req R-DASH-25
it("resolves presets, explicit ranges, lists and text into typed parameters", () => {
  const now = new Date("2026-09-09T15:30:00.000Z");
  const time = resolveDashboardVariables(
    [
      ...standardDashboardVariables,
      { name: "note", type: "text", default: "hello" },
    ],
    { time_range: "7d", repo: ["github.com/a/b"] },
    now,
  );
  expect(time.parameters).toEqual({
    time_range_from: Date.UTC(2026, 8, 3) / 1000,
    time_range_to: Date.UTC(2026, 8, 10) / 1000,
    repo: ["github.com/a/b"],
    note: "hello",
  });
  expect(time.resolved.time_range).toEqual({
    from: "2026-09-03T00:00:00.000Z",
    to: "2026-09-10T00:00:00.000Z",
  });
  const week = resolveDashboardVariables(
    standardDashboardVariables,
    { time_range: "this_week" },
    now,
  );
  expect(week.resolved.time_range).toEqual({
    from: "2026-09-07T00:00:00.000Z",
    to: "2026-09-14T00:00:00.000Z",
  });
  expect(week.resolved.repo).toEqual([]);
  const explicit = resolveDashboardVariables(
    standardDashboardVariables,
    {
      time_range: {
        from: "2026-01-01T00:00:00.000Z",
        to: "2026-02-01T00:00:00.000Z",
      },
    },
    now,
  );
  expect(explicit.parameters.time_range_from).toBe(Date.UTC(2026, 0, 1) / 1000);
  const fallback = resolveDashboardVariables(
    standardDashboardVariables,
    {},
    now,
  );
  expect(fallback.resolved.time_range).toEqual({
    from: "2026-08-11T00:00:00.000Z",
    to: "2026-09-10T00:00:00.000Z",
  });
});

// @req R-MCP-09
it("advertises compact tool-facing dashboard inputs that accept every strict definition and carry no references", () => {
  const compact = { version: 2, tiles: [{ id: "x", type: "bogus" }] };
  expect(dashboardDefinitionToolSchema.safeParse(compact).success).toBe(true);
  expect(dashboardDefinitionSchema.safeParse(compact).success).toBe(false);
  for (const dashboard of builtinDashboards) {
    expect(
      dashboardRenderToolInputSchema.safeParse({
        definition: dashboard.definition,
      }).success,
      dashboard.name,
    ).toBe(true);
    expect(
      dashboardSaveToolInputSchema.safeParse({
        name: dashboard.name,
        definition: dashboard.definition,
      }).success,
      dashboard.name,
    ).toBe(true);
  }
  for (const template of dashboardTileTemplates)
    expect(
      dashboardDefinitionToolSchema.safeParse({
        version: 2,
        variables: template.variables,
        tiles: [template.tile],
      }).success,
      template.id,
    ).toBe(true);
  for (const schema of [
    dashboardRenderToolInputSchema,
    dashboardSaveToolInputSchema,
  ]) {
    const rendered = JSON.stringify(z.toJSONSchema(schema, { io: "input" }));
    expect(rendered).not.toMatch(/"\$(ref|defs)"/);
    expect(new TextEncoder().encode(rendered).length).toBeLessThan(4096);
    // The description is derived from the strict schema: allowlisted keys stay in sync.
    expect(rendered).toContain("type line|bar|pie|scatter|gauge|heatmap");
    expect(rendered).toContain("stat {sql, value?, compare?, unit?}");
    expect(rendered).toContain("angleAxis?");
  }
});
