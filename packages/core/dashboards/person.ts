import {
  dashboardDefinitionSchema,
  type DashboardDefinition,
  type DashboardVariable,
} from "../schemas/dashboards.js";

/**
 * Variables of the person dashboard: the member's email as a typed `{person:String}`
 * parameter and a time range that starts at everything, since the page describes one
 * person's whole history rather than the team's recent window.
 */
const personDashboardVariables: DashboardVariable[] = [
  {
    name: "time_range",
    type: "time_range",
    label: "Time range",
    default: "all",
  },
  { name: "person", type: "text", label: "Person", default: "" },
];
/** Sessions the member ran in the window; `user_email` is an `api_ro.sessions` column. */
const scope =
  "started_at >= {time_range_from:DateTime} AND started_at < {time_range_to:DateTime} AND user_email = {person:String}";
/**
 * Four of the stats read one aggregate row of `sessions`, so those numbers cost one scan
 * and each picks its column. Session counts are roots only (`parent_session_id IS NULL`),
 * matching the team dashboard's "Captured sessions" and the roots-only session list below on
 * the same page; message and tool-call sums stay over every session, child runs included
 * (templates.ts rootScope rule).
 */
const activity = `SELECT countIf(parent_session_id IS NULL) AS sessions, sum(message_count) AS messages, sum(tool_call_count) AS tool_calls, max(last_activity_at) AS last_active FROM sessions WHERE ${scope}`;
/**
 * "Sessions that searched" and "Sessions reusing prior work" read the roots-only metric
 * relations, not the per-session `sessions` columns, so a member's root that delegated its
 * search or reuse to a subagent still counts: those relations roll each subagent's reads up
 * to the root (analytics.ts). The relations carry `user_id`, so the member is selected by
 * mapping the page's email through `users` rather than scanning the heavier `sessions` view.
 */
const memberWindow =
  "started_at >= {time_range_from:DateTime} AND started_at < {time_range_to:DateTime} AND parent_session_id IS NULL AND user_id IN (SELECT id FROM users WHERE email = {person:String})";
const searched = `SELECT countIf(agentcommons_search_calls > 0) AS searched FROM metrics_search_sessions WHERE ${memberWindow}`;
const reused = `SELECT countIf(reused) AS reused FROM metrics_reuse_sessions WHERE ${memberWindow}`;
const stat = (
  id: string,
  title: string,
  value: string,
  x: number,
  y: number,
  sql: string = activity,
) => ({
  id,
  type: "stat",
  title,
  layout: { x, y, w: 3, h: 2 },
  sql,
  value,
  unit: "count",
});

/**
 * One member's activity over the organization's captured sessions, rendered inline by the
 * person page (`/app/admin/users/:id`) with `person` fixed to the member's email. Every tile
 * is a guarded read through the query service, so the row policies decide what it counts.
 */
export const personDashboard: DashboardDefinition =
  dashboardDefinitionSchema.parse({
    version: 2,
    variables: personDashboardVariables,
    tiles: [
      stat("sessions", "Sessions captured", "sessions", 0, 0),
      stat("messages", "Messages", "messages", 3, 0),
      stat("searched", "Sessions that searched", "searched", 6, 0, searched),
      stat("reused", "Sessions reusing prior work", "reused", 9, 0, reused),
      stat("tool_calls", "Tool calls", "tool_calls", 0, 2),
      stat("last_active", "Last active", "last_active", 3, 2),
      {
        id: "harnesses",
        type: "chart",
        title: "Coding tools",
        layout: { x: 6, y: 2, w: 6, h: 5 },
        sql: `SELECT harness AS name, count() AS value FROM sessions WHERE ${scope} AND parent_session_id IS NULL GROUP BY harness ORDER BY value DESC`,
        chart: {
          series: [
            {
              type: "pie",
              radius: ["45%", "72%"],
              encode: { itemName: "name", value: "value" },
            },
          ],
          legend: {},
        },
      },
      {
        id: "repositories",
        type: "table",
        title: "Repositories",
        layout: { x: 0, y: 4, w: 6, h: 5 },
        sql: `SELECT repo_name, countIf(parent_session_id IS NULL) AS sessions, sum(message_count) AS messages, max(last_activity_at) AS last_active FROM sessions WHERE ${scope} AND repo_name IS NOT NULL GROUP BY repo_name ORDER BY sessions DESC, repo_name LIMIT 10`,
      },
    ],
  });
