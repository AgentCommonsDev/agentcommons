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
 * Every stat reads one aggregate row; the renderer runs identical tile SQL once per
 * request, so the six numbers cost one scan of `sessions`, and each stat picks its column.
 */
const activity = `SELECT count() AS sessions, sum(message_count) AS messages, sum(tool_call_count) AS tool_calls, countIf(agentcommons_search_calls > 0) AS searched, countIf(reuses_made > 0) AS reused, max(last_activity_at) AS last_active FROM sessions WHERE ${scope}`;
const stat = (
  id: string,
  title: string,
  value: string,
  x: number,
  y: number,
) => ({
  id,
  type: "stat",
  title,
  layout: { x, y, w: 3, h: 2 },
  sql: activity,
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
      stat("searched", "Sessions that searched", "searched", 6, 0),
      stat("reused", "Sessions reusing prior work", "reused", 9, 0),
      stat("tool_calls", "Tool calls", "tool_calls", 0, 2),
      stat("last_active", "Last active", "last_active", 3, 2),
      {
        id: "harnesses",
        type: "chart",
        title: "Coding tools",
        layout: { x: 6, y: 2, w: 6, h: 5 },
        sql: `SELECT harness AS name, count() AS value FROM sessions WHERE ${scope} GROUP BY harness ORDER BY value DESC`,
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
        sql: `SELECT repo_name, count() AS sessions, sum(message_count) AS messages, max(last_activity_at) AS last_active FROM sessions WHERE ${scope} AND repo_name IS NOT NULL GROUP BY repo_name ORDER BY sessions DESC, repo_name LIMIT 10`,
      },
    ],
  });
