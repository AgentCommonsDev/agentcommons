import {
  dashboardTileTemplateSchema,
  type DashboardTileTemplate,
  type DashboardVariable,
} from "../schemas/dashboards.js";

/** Standard variables every starter tile can rely on. */
export const standardDashboardVariables: DashboardVariable[] = [
  {
    name: "time_range",
    type: "time_range",
    label: "Time range",
    default: "30d",
  },
  { name: "repo", type: "repo", label: "Repository" },
];
/** Window predicate; `alias` qualifies `started_at` when the tile joins `sessions` under a name. */
const timeOf = (alias = "") =>
  `${alias}started_at >= {time_range_from:DateTime} AND ${alias}started_at < {time_range_to:DateTime}`;
const time = timeOf();
const repo =
  "(empty({repo:Array(String)}) OR repo_name IN {repo:Array(String)})";
const scope = `${time} AND ${repo}`;
/**
 * Root sessions only: `parent_session_id IS NULL` selects a root. On the `sessions` view
 * that parent is the caller-visible parent; on `metrics_search_sessions` and
 * `metrics_reuse_sessions` it is the projection's raw parent (a true root). Every tile that
 * counts or lists sessions uses this, so the dashboard agrees with the Sessions list
 * (`roots_only`), and a subagent, fork or spawned run counts inside its root: the metric
 * relations roll each subagent's search and reuse reads up to the root before this
 * roots-only filter, so its search/reuse activity is included rather than dropped. Sums of
 * messages, tool calls and tokens stay over every session, child runs included.
 */
const rootScope = `${scope} AND parent_session_id IS NULL`;
export const dashboardScopeSql = { time, repo, scope, rootScope };
/** Display name of the member who ran a session, falling back to the email address. */
const person = "coalesce(nullIf(user_name,''),user_email)";
// Per-person tiles rank people with window functions over one aggregate so `sessions`
// (the most expensive view) is scanned once, not once for the leaders and once for the rows.
const layout = (w: number, h: number) => ({ x: 0, y: 0, w, h });
const standard = standardDashboardVariables;

/** Starter tiles offered by the editor and returned to agents; each is a complete valid tile. */
export const dashboardTileTemplates: DashboardTileTemplate[] = [
  {
    id: "captured_sessions",
    title: "Captured sessions",
    description:
      "How many sessions were recorded in the selected window; subagent runs count inside their root session.",
    variables: standard,
    tile: {
      id: "captured_sessions",
      type: "stat",
      title: "Captured sessions",
      layout: layout(3, 2),
      sql: `SELECT count() AS value FROM sessions WHERE ${rootScope}`,
      unit: "count",
    },
  },
  {
    id: "search_sessions",
    title: "Sessions that searched AgentCommons",
    description:
      "Sessions whose agent ran an AgentCommons search or sql query while active.",
    variables: standard,
    tile: {
      id: "search_sessions",
      type: "stat",
      title: "Sessions that searched",
      layout: layout(3, 2),
      sql: `SELECT countIf(agentcommons_search_calls > 0) AS value FROM metrics_search_sessions WHERE ${rootScope}`,
      unit: "count",
    },
  },
  {
    id: "reuse_sessions",
    title: "Sessions reusing prior work",
    description: "Sessions that read another session while active.",
    variables: standard,
    tile: {
      id: "reuse_sessions",
      type: "stat",
      title: "Sessions reusing prior work",
      layout: layout(3, 2),
      sql: `SELECT countIf(reused) AS value FROM metrics_reuse_sessions WHERE ${rootScope}`,
      unit: "count",
    },
  },
  {
    id: "reuse_rate",
    title: "Reuse rate",
    description: "Share of sessions that reused prior work.",
    variables: standard,
    tile: {
      id: "reuse_rate",
      type: "stat",
      title: "Reuse rate",
      layout: layout(3, 2),
      sql: `SELECT toFloat64(countIf(reused)) / nullIf(count(), 0) AS value FROM metrics_reuse_sessions WHERE ${rootScope}`,
      unit: "ratio",
    },
  },
  {
    id: "reuse_trend",
    title: "Weekly reuse rate",
    description:
      "Reuse rate and cross-user reuse rate by week over the selected window and repository.",
    variables: standard,
    tile: {
      id: "reuse_trend",
      type: "chart",
      title: "Weekly reuse rate",
      description: "By week over the selected window. Weeks start on Monday.",
      layout: layout(8, 5),
      // Bucketed from the same scanned view as the Reuse rate stat tile so the window and
      // repository filters apply, rather than the unscoped org-wide `metrics_reuse_weekly`.
      sql: `SELECT toStartOfWeek(started_at, 1) AS week, toFloat64(countIf(reused)) / nullIf(count(), 0) AS reuse_rate, toFloat64(countIf(cross_user_reused)) / nullIf(count(), 0) AS cross_user_reuse_rate FROM metrics_reuse_sessions WHERE ${rootScope} GROUP BY week ORDER BY week`,
      unit: "ratio",
      chart: {
        series: [
          {
            type: "line",
            name: "Reuse rate",
            smooth: true,
            encode: { x: "week", y: "reuse_rate" },
          },
          {
            type: "line",
            name: "Cross-user reuse rate",
            smooth: true,
            encode: { x: "week", y: "cross_user_reuse_rate" },
          },
        ],
        xAxis: { type: "category" },
        yAxis: { type: "value", min: 0 },
        legend: {},
      },
    },
  },
  {
    id: "reuse_outcomes",
    title: "Reuse vs no reuse: outcomes",
    description:
      "Sessions that reused prior work compared with those that did not, on effort and completion. An association, not proof reuse caused it.",
    variables: standard,
    tile: {
      id: "reuse_outcomes",
      type: "table",
      title: "Reuse vs no reuse: outcomes",
      description:
        "Three cohorts by how a session reused prior work. Observational: reusing sessions may differ in task, person or repository.",
      layout: layout(7, 6),
      // Root sessions split into three disjoint cohorts (no reuse, same-user reuse, cross-user
      // reuse), then the effort and completion signals per cohort from the one scanned view.
      sql: `SELECT multiIf(reused = 0, 'No reuse', cross_user_reused = 1, 'Cross-user reuse', 'Same-user reuse') AS cohort, count() AS sessions, avg(duration_seconds) AS avg_duration_seconds, avg(tokens) AS avg_tokens, avg(tool_call_count) AS avg_tool_calls, toFloat64(countIf(completed)) / nullIf(count(), 0) AS completed_rate FROM metrics_reuse_outcomes WHERE ${rootScope} GROUP BY cohort ORDER BY max(reused), max(cross_user_reused)`,
    },
  },
  {
    id: "sessions_per_day",
    title: "Sessions per day",
    description: "Daily captured sessions, stacked by coding tool.",
    variables: standard,
    tile: {
      id: "sessions_per_day",
      type: "chart",
      title: "Sessions per day",
      layout: layout(8, 5),
      sql: `SELECT toDate(started_at) AS day, harness, count() AS sessions FROM sessions WHERE ${rootScope} GROUP BY day, harness ORDER BY day`,
      series_by: "harness",
      chart: {
        series: [
          { type: "bar", stack: "total", encode: { x: "day", y: "sessions" } },
        ],
        xAxis: { type: "category" },
        yAxis: { type: "value" },
        legend: {},
      },
    },
  },
  {
    id: "harness_share",
    title: "Sessions by coding tool",
    description: "Share of sessions per harness.",
    variables: standard,
    tile: {
      id: "harness_share",
      type: "chart",
      title: "Sessions by coding tool",
      layout: layout(4, 5),
      sql: `SELECT harness AS name, count() AS value FROM sessions WHERE ${rootScope} GROUP BY harness ORDER BY value DESC`,
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
  },
  {
    id: "top_tools",
    title: "Most used tools",
    description:
      "How many sessions used each tool, by tool name, in the selected window.",
    variables: standard,
    tile: {
      id: "top_tools",
      type: "chart",
      title: "Most used tools",
      layout: layout(5, 6),
      sql: `SELECT t.tool_name AS tool, count() AS sessions FROM session_tools t JOIN sessions s ON s.session_id = t.session_id WHERE ${timeOf("s.")} AND (empty({repo:Array(String)}) OR s.repo_name IN {repo:Array(String)}) AND s.parent_session_id IS NULL GROUP BY tool ORDER BY sessions DESC LIMIT 12`,
      chart: {
        series: [{ type: "bar", encode: { x: "sessions", y: "tool" } }],
        xAxis: { type: "value" },
        yAxis: { type: "category", inverse: true },
      },
    },
  },
  {
    id: "top_repos",
    title: "Most active repositories",
    description: "Sessions, people and reused sessions per repository.",
    variables: standard,
    tile: {
      id: "top_repos",
      type: "table",
      title: "Most active repositories",
      layout: layout(4, 5),
      sql: `SELECT repo_name, count() AS sessions, uniqExact(user_id) AS people, countIf(reuse_count > 0) AS reused FROM sessions WHERE ${rootScope} AND repo_name IS NOT NULL GROUP BY repo_name ORDER BY sessions DESC LIMIT 10`,
    },
  },
  {
    id: "most_reused",
    title: "Most reused sessions",
    description: "Sessions other sessions read most often.",
    variables: standard,
    tile: {
      id: "most_reused",
      type: "table",
      title: "Most reused sessions",
      layout: layout(7, 6),
      sql: `SELECT session_id, title, user_email, repo_name, reuse_count, started_at FROM sessions WHERE ${rootScope} AND reuse_count > 0 ORDER BY reuse_count DESC, started_at DESC LIMIT 10`,
    },
  },
  {
    id: "active_people",
    title: "Active people",
    description: "Members who ran at least one session in the selected window.",
    variables: standard,
    tile: {
      id: "active_people",
      type: "stat",
      title: "Active people",
      layout: layout(3, 2),
      sql: `SELECT uniqExact(user_id) AS value FROM sessions WHERE ${scope}`,
      unit: "count",
    },
  },
  {
    id: "messages_total",
    title: "Messages",
    description: "Transcript messages across the selected sessions.",
    variables: standard,
    tile: {
      id: "messages_total",
      type: "stat",
      title: "Messages",
      layout: layout(3, 2),
      sql: `SELECT sum(message_count) AS value FROM sessions WHERE ${scope}`,
      unit: "count",
    },
  },
  {
    id: "tool_calls_total",
    title: "Tool calls",
    description: "Tool calls across the selected sessions.",
    variables: standard,
    tile: {
      id: "tool_calls_total",
      type: "stat",
      title: "Tool calls",
      layout: layout(3, 2),
      sql: `SELECT sum(tool_call_count) AS value FROM sessions WHERE ${scope}`,
      unit: "count",
    },
  },
  {
    id: "sessions_per_person",
    title: "Sessions per person",
    description: "The 15 members with the most sessions.",
    variables: standard,
    tile: {
      id: "sessions_per_person",
      type: "chart",
      title: "Sessions per person",
      layout: layout(6, 6),
      sql: `SELECT ${person} AS person, count() AS sessions FROM sessions WHERE ${rootScope} GROUP BY person ORDER BY sessions DESC, person LIMIT 15`,
      chart: {
        series: [{ type: "bar", encode: { x: "sessions", y: "person" } }],
        xAxis: { type: "value" },
        yAxis: { type: "category", inverse: true },
      },
    },
  },
  {
    id: "tokens_per_person",
    title: "Tokens per person",
    description:
      "The 15 members who consumed the most tokens (input plus output).",
    variables: standard,
    tile: {
      id: "tokens_per_person",
      type: "chart",
      title: "Tokens per person",
      layout: layout(6, 6),
      sql: `SELECT ${person} AS person, sum(input_tokens + output_tokens) AS tokens FROM sessions WHERE ${scope} GROUP BY person ORDER BY tokens DESC, person LIMIT 15`,
      unit: "count",
      chart: {
        series: [{ type: "bar", encode: { x: "tokens", y: "person" } }],
        xAxis: { type: "value" },
        yAxis: { type: "category", inverse: true },
      },
    },
  },
  {
    id: "activity_per_person",
    title: "Activity per person",
    description:
      "Sessions, messages, tool calls, tokens, repositories and last activity per member.",
    variables: standard,
    tile: {
      id: "activity_per_person",
      type: "table",
      title: "Activity per person",
      layout: layout(6, 6),
      sql: `SELECT ${person} AS person, countIf(parent_session_id IS NULL) AS sessions, sum(message_count) AS messages, sum(tool_call_count) AS tool_calls, sum(input_tokens + output_tokens) AS tokens, uniqExact(repo_name) AS repositories, max(last_activity_at) AS last_active FROM sessions WHERE ${scope} GROUP BY person ORDER BY sessions DESC, person LIMIT 50`,
    },
  },
  {
    id: "sessions_per_day_by_person",
    title: "Sessions per day by person",
    description:
      "Daily sessions stacked by member; the 8 most active are named, everyone else is Other.",
    variables: standard,
    tile: {
      id: "sessions_per_day_by_person",
      type: "chart",
      title: "Sessions per day by person",
      layout: layout(8, 5),
      sql: `SELECT day, if(rank <= 8, who, 'Other') AS person, sum(n) AS sessions FROM (SELECT day, who, n, dense_rank() OVER (ORDER BY total DESC, who) AS rank FROM (SELECT day, who, n, sum(n) OVER (PARTITION BY who) AS total FROM (SELECT toDate(started_at) AS day, ${person} AS who, count() AS n FROM sessions WHERE ${rootScope} GROUP BY day, who))) GROUP BY day, person ORDER BY day, person`,
      series_by: "person",
      chart: {
        series: [
          { type: "bar", stack: "total", encode: { x: "day", y: "sessions" } },
        ],
        xAxis: { type: "category" },
        yAxis: { type: "value" },
        legend: {},
      },
    },
  },
  {
    id: "repos_per_person",
    title: "Repositories per person",
    description: "Each member's three most worked-on repositories.",
    variables: standard,
    tile: {
      id: "repos_per_person",
      type: "table",
      title: "Repositories per person",
      layout: layout(6, 6),
      sql: `SELECT person, repo_name, sessions, last_session FROM (SELECT ${person} AS person, repo_name, count() AS sessions, max(started_at) AS last_session, row_number() OVER (PARTITION BY person ORDER BY count() DESC, repo_name) AS repo_rank FROM sessions WHERE ${rootScope} AND repo_name IS NOT NULL GROUP BY person, repo_name) WHERE repo_rank <= 3 ORDER BY person, sessions DESC LIMIT 60`,
    },
  },
  {
    id: "duration_per_person",
    title: "Average session duration per person",
    description:
      "Mean seconds from start to end or last activity, for the 15 longest averages.",
    variables: standard,
    tile: {
      id: "duration_per_person",
      type: "chart",
      title: "Average session duration",
      layout: layout(6, 6),
      sql: `SELECT ${person} AS person, avg(duration_seconds) AS avg_seconds FROM sessions WHERE ${rootScope} GROUP BY person ORDER BY avg_seconds DESC, person LIMIT 15`,
      unit: "seconds",
      chart: {
        series: [{ type: "bar", encode: { x: "avg_seconds", y: "person" } }],
        xAxis: { type: "value" },
        yAxis: { type: "category", inverse: true },
      },
    },
  },
  {
    id: "harness_per_person",
    title: "Coding tools per person",
    description: "Sessions per coding tool for the 10 most active members.",
    variables: standard,
    tile: {
      id: "harness_per_person",
      type: "chart",
      title: "Coding tools per person",
      layout: layout(4, 5),
      sql: `SELECT who AS person, harness, n AS sessions FROM (SELECT who, harness, n, total, dense_rank() OVER (ORDER BY total DESC, who) AS rank FROM (SELECT who, harness, n, sum(n) OVER (PARTITION BY who) AS total FROM (SELECT ${person} AS who, harness, count() AS n FROM sessions WHERE ${rootScope} GROUP BY who, harness))) WHERE rank <= 10 ORDER BY total DESC, person, harness`,
      series_by: "harness",
      chart: {
        series: [
          {
            type: "bar",
            stack: "total",
            encode: { x: "person", y: "sessions" },
          },
        ],
        xAxis: { type: "category", axisLabel: { rotate: 30 } },
        yAxis: { type: "value" },
        legend: {},
      },
    },
  },
  {
    id: "recent_sessions",
    title: "Recent sessions",
    description: "The latest captured sessions.",
    variables: standard,
    tile: {
      id: "recent_sessions",
      type: "table",
      title: "Recent sessions",
      layout: layout(6, 6),
      sql: `SELECT session_id, title, user_email, repo_name, harness, started_at FROM sessions WHERE ${rootScope} ORDER BY started_at DESC LIMIT 20`,
    },
  },
  {
    id: "zero_result_searches",
    title: "Your searches with no results",
    description: "Searches you ran that found nothing; only visible to you.",
    variables: [],
    tile: {
      id: "zero_result_searches",
      type: "table",
      title: "Your searches with no results",
      layout: layout(6, 5),
      sql: "SELECT searched_at, query FROM metrics_own_zero_results ORDER BY searched_at DESC LIMIT 20",
    },
  },
  {
    id: "note",
    title: "Text",
    description: "A heading or note in Markdown.",
    variables: [],
    tile: {
      id: "note",
      type: "text",
      title: "Note",
      layout: layout(12, 2),
      markdown:
        "Write a heading, a note or a link for the people reading this dashboard.",
    },
  },
  {
    id: "time_range_control",
    title: "Time range picker",
    description: "Places the time range control on the canvas.",
    variables: standard,
    tile: {
      id: "time_range_control",
      type: "control",
      title: "Time range",
      layout: layout(3, 2),
      variable: "time_range",
    },
  },
].map((template) => dashboardTileTemplateSchema.parse(template));
