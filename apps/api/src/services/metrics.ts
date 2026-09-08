import { z } from "zod";
import { compactMetadata, wireValue } from "./read-budget.js";
import {
  metricsGroupSchema,
  metricsInputSchema,
  metricsOutputSchema,
  metricRowSchema,
  searchAdoptionMetricNames,
} from "@agentcommons/core";
import { Parameters } from "../repositories/read-model.js";
import { searchAdoptionSelect } from "../repositories/search-adoption.js";
import { readOperation, type ReadDependencies } from "./read-operation.js";
import type { ServiceContext } from "./context.js";

/** Static SQL fragments only; caller filters and pagination are always parameters. */
function metric(
  metric: string,
  value: string,
  options: {
    from?: string;
    date?: string;
    repo?: string;
    harness?: string;
    user?: string;
    tool?: string;
    policy?: string;
    enabled?: string;
    numerator?: string;
    denominator?: string;
    unit?: string;
    group?: string;
    where?: string;
  } = {},
) {
  return `SELECT '${metric}' AS metric, CAST(toString(${options.date ?? "NULL"}),'Nullable(String)') AS date,
 CAST(${options.repo ?? "NULL"},'Nullable(String)') AS repo_name, CAST(${options.harness ?? "NULL"},'Nullable(String)') AS harness,
 CAST(${options.user ?? "NULL"},'Nullable(String)') AS user_id, CAST(${options.tool ?? "NULL"},'Nullable(String)') AS tool,
 CAST(${options.policy ?? "NULL"},'Nullable(String)') AS policy_id, CAST(${options.enabled ?? "NULL"},'Nullable(Bool)') AS tools_enabled,
 toFloat64(${value}) AS value, toFloat64(${options.numerator ?? "NULL"}) AS numerator,
 toFloat64(${options.denominator ?? "NULL"}) AS denominator, '${options.unit ?? "count"}' AS unit
 ${options.from ? `FROM ${options.from}` : ""} ${options.where ? `WHERE ${options.where}` : ""}
 ${options.group ? `GROUP BY ${options.group}` : ""}`;
}
const ratio = (count: string, denominator = "count(*)") =>
  `toFloat64(${count})/nullIf(${denominator},0)`;
const weekly = "toMonday(started_at)";
function statements(
  group: z.infer<typeof metricsGroupSchema>,
  bounds: { from: string; to: string; repo: string },
) {
  const filter = (date: string, qualifier = "") =>
    `${date}>=${bounds.from} AND ${date}<${bounds.to} AND (${bounds.repo} IS NULL OR ${qualifier}repo_name=${bounds.repo})`;
  switch (group) {
    case "reuse":
      return {
        cte: `s AS MATERIALIZED (SELECT started_at,reused,cross_user_reused FROM api_ro.metrics_reuse_sessions WHERE ${filter("started_at")}), weeks AS MATERIALIZED (
        SELECT addWeeks(toMonday(${bounds.from}),arrayJoin(range(toUInt64(dateDiff('week',toMonday(${bounds.from}),toMonday(subtractMicroseconds(${bounds.to},1)))+1)))) AS week
      ), totals AS MATERIALIZED (SELECT ${weekly} AS week,count(*) AS sessions,countIf(reused) AS reuse_sessions,
       countIf(cross_user_reused) AS cross_user_reuse_sessions FROM s GROUP BY 1), w AS MATERIALIZED (
       SELECT weeks.week,coalesce(t.sessions,0) AS sessions,coalesce(t.reuse_sessions,0) AS reuse_sessions,
       coalesce(t.cross_user_reuse_sessions,0) AS cross_user_reuse_sessions FROM weeks LEFT JOIN totals t USING(week))`,
        selects: (
          [
            ["reuse_rate", "reuse_sessions"],
            ["cross_user_reuse_rate", "cross_user_reuse_sessions"],
          ] as const
        ).map(([name, count]) =>
          metric(name, ratio(count, "sessions"), {
            from: "w",
            date: "week",
            numerator: count,
            denominator: "sessions",
            unit: "ratio",
          }),
        ),
      };
    case "health":
      return {
        cte: `s AS MATERIALIZED (SELECT * FROM api_ro.metrics_health WHERE ${filter("started_at")}), c AS MATERIALIZED (SELECT * FROM api_ro.metrics_capture WHERE ${filter("received_at")}), r AS MATERIALIZED (SELECT * FROM api_ro.metrics_redaction WHERE ${filter("created_at")})`,
        selects: [
          metric(
            "capture_coverage",
            ratio(
              "count(DISTINCT installation_id)",
              "(SELECT member_count FROM api_ro.metrics_members)",
            ),
            {
              from: "api_ro.metrics_activity activity",
              where: `${filter("activity.received_at", "activity.")} AND activity.received_at>=subtractDays(${bounds.to},7)`,
              numerator: "count(DISTINCT installation_id)",
              denominator: "(SELECT member_count FROM api_ro.metrics_members)",
              unit: "ratio",
            },
          ),
          metric("sessions", "count(*)", {
            from: "s",
            date: "toDate(started_at)",
            repo: "repo_name",
            harness: "harness",
            user: "user_id",
            group: "2,3,4,5",
          }),
          metric(
            "capture_latency_seconds",
            "quantileExactInclusiveOrNull(0.5)(latency_seconds)",
            { from: "c", where: "latency_seconds>=0", unit: "seconds" },
          ),
          metric("negative_capture_latency_records", "count(*)", {
            from: "c",
            where: "latency_seconds<0",
          }),
          metric("authorization_blocked_sessions", "count(*)", {
            from: "s",
            where: "authorization_blocked",
          }),
          metric("redaction_hits", "sum(count)", {
            from: "r",
            policy: "policy_id",
            group: "7",
          }),
        ],
      };
    case "usage":
      return {
        cte: `a AS MATERIALIZED (SELECT * FROM api_ro.metrics_usage WHERE ${filter("ts")}), s AS MATERIALIZED (SELECT memory_assisted FROM api_ro.metrics_reuse_sessions WHERE ${filter("started_at")}), m AS MATERIALIZED (SELECT * FROM api_ro.metrics_mcp_calls WHERE ${filter("ts")}), d AS MATERIALIZED (SELECT * FROM api_ro.metrics_dashboard WHERE ${filter("ts")}), t AS MATERIALIZED (SELECT agentcommons_search_calls,repeat_agentcommons_search_calls,subsequent_other_search_calls FROM api_ro.metrics_search_sessions WHERE ${filter("started_at")}), adoption AS MATERIALIZED (SELECT ${searchAdoptionSelect} FROM t)`,
        selects: [
          ...searchAdoptionMetricNames.map((name) =>
            metric(name, name, {
              from: "adoption",
              ...(name === "agentcommons_search_rate"
                ? {
                    numerator: "agentcommons_search_sessions",
                    denominator: "sessions",
                    unit: "ratio",
                  }
                : {}),
            }),
          ),
          metric("mcp_calls", "count(*)", {
            from: "m",
            date: "toDate(ts)",
            tool: "action",
            group: "2,6",
          }),
          metric("memory_assisted_rate", ratio("countIf(memory_assisted)"), {
            from: "s",
            numerator: "countIf(memory_assisted)",
            denominator: "count(*)",
            unit: "ratio",
          }),
          metric("follow_through_rate", ratio("countIf(followed_through)"), {
            from: "a",
            where: "action='search' AND hits IS NOT NULL",
            numerator: "countIf(followed_through)",
            denominator: "count(*)",
            unit: "ratio",
          }),
          metric("zero_result_rate", ratio("countIf(hits=0)"), {
            from: "a",
            where: "action='search' AND hits IS NOT NULL",
            numerator: "countIf(hits=0)",
            denominator: "count(*)",
            unit: "ratio",
          }),
          metric("cross_user_hit_rate", ratio("countIf(cross_user_hit)"), {
            from: "a",
            where: "action='search' AND hits>0",
            numerator: "countIf(cross_user_hit)",
            denominator: "count(*)",
            unit: "ratio",
          }),
          metric("dashboard_weekly_actives", "count(DISTINCT d.user_id)", {
            from: "d",
            date: "toMonday(ts)",
            group: "2",
          }),
          metric("dashboard_searches", "count(*)", {
            from: "d",
            where: "action='search'",
            date: "toDate(ts)",
            group: "2",
          }),
          metric("dashboard_session_views", "count(*)", {
            from: "d",
            where: "action='get'",
            date: "toDate(ts)",
            group: "2",
          }),
        ],
      };
    case "outcomes":
      return {
        cte: `s AS MATERIALIZED (SELECT * FROM api_ro.metrics_outcomes WHERE ${filter("started_at")})`,
        selects: [
          ...(
            [
              ["tool_calls_per_session", "tool_call_count", "count"],
              ["tokens_per_session", "tokens", "tokens"],
              ["duration_seconds_per_session", "duration_seconds", "seconds"],
            ] as const
          ).map(([name, column, unit]) =>
            metric(name, `avgOrNull(${column})`, {
              from: "s",
              repo: "repo_name",
              enabled: "tools_enabled",
              numerator: `sum(${column})`,
              denominator: "count(*)",
              unit,
              group: "3,8",
            }),
          ),
          ...(
            [
              ["near_duplicate_rate", "near_duplicate"],
              ["rerun_loop_rate", "rerun_loop"],
              ["observed_commit_rate", "observed_commit"],
            ] as const
          ).map(([name, column]) =>
            metric(name, ratio(`countIf(${column})`), {
              from: "s",
              repo: "repo_name",
              enabled: "tools_enabled",
              numerator: `countIf(${column})`,
              denominator: "count(*)",
              unit: "ratio",
              group: "3,8",
            }),
          ),
        ],
      };
  }
}
const offsetSchema = z.strictObject({ offset: z.number().int().nonnegative() });
export class MetricsService {
  constructor(private readonly dependencies: ReadDependencies) {}
  get(context: ServiceContext, groupInput: unknown, input: unknown) {
    return readOperation(
      this.dependencies.audit,
      context,
      {
        action: "admin.metrics",
        resourceType: "metrics",
        detail: { group: groupInput, input },
      },
      async (caller) => {
        const group = metricsGroupSchema.parse(groupInput);
        const request = metricsInputSchema.parse(input);
        const { cursor, ...parameters } = request;
        const binding = wireValue({
          organizationId: caller.organizationId,
          operation: "admin.metrics",
          group,
          input: parameters,
        });
        const offset = cursor
          ? this.dependencies.cursors.decode(cursor, binding, offsetSchema)
              .offset
          : 0;
        const rows = await this.dependencies.readers.read(
          caller,
          async (client) => {
            const values = new Parameters();
            const from = `parseDateTime64BestEffort(${values.add(request.filters.date_from)},6,'UTC')`;
            const to = `parseDateTime64BestEffort(${values.add(request.filters.date_to)},6,'UTC')`;
            const repo = values.add(
              request.filters.repo_name ?? null,
              "Nullable(String)",
            );
            const selectedMetric = values.add(
              request.filters.metric ?? null,
              "Nullable(String)",
            );
            const definition = statements(group, { from, to, repo });
            const result = await client.query(
              `WITH ${definition.cte}, rows AS (${definition.selects.join(" UNION ALL ")}) SELECT * FROM rows
          WHERE (${selectedMetric} IS NULL OR metric=${selectedMetric}) ORDER BY ${request.sort ?? "date"} ${request.order} NULLS LAST,metric,date,repo_name,harness,user_id,tool,policy_id,tools_enabled
          LIMIT ${values.add(request.limit + 1)} OFFSET ${values.add(offset)}`,
              values.values,
            );
            return z
              .array(metricRowSchema)
              .parse(
                result.rows.map((row: Record<string, unknown>) =>
                  compactMetadata(row, [
                    "repo_name",
                    "harness",
                    "user_id",
                    "tool",
                  ]),
                ),
              );
          },
        );
        const more = rows.length > request.limit;
        return metricsOutputSchema.parse({
          items: rows.slice(0, request.limit),
          cursor: more
            ? this.dependencies.cursors.encode(binding, {
                offset: offset + request.limit,
              })
            : null,
        });
      },
      (result) => ({ rows: result.items.length }),
      "admin",
    );
  }
}
