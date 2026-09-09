import { z } from "zod";
import { compactMetadata, offsetPage, wireValue } from "./read-budget.js";
import {
  metricsGroupSchema,
  metricsInputSchema,
  metricsOutputSchema,
  metricRowSchema,
  searchAdoptionMetricNames,
} from "@agentcommons/core";
import { Parameters } from "../repositories/read-model.js";
import { readOperation, type ReadDependencies } from "./read-operation.js";
import type { ServiceContext } from "./context.js";

/** Dimension columns in the order `metric()` selects them after `metric`, so ordinals 2..8 follow. */
const DIMENSIONS = [
  "date",
  "repo",
  "harness",
  "user",
  "tool",
  "policy",
  "enabled",
] as const;
type MetricOptions = Partial<Record<(typeof DIMENSIONS)[number], string>> & {
  where?: string;
  /** Group by every dimension this metric sets. */
  group?: true;
  unit?: string;
} & (
    | { value: string; numerator?: string; denominator?: string }
    /** Without a value, the metric is the ratio of its numerator to its denominator. */
    | { value?: undefined; numerator: string; denominator: string }
  );
/** Static SQL fragments only; caller filters and pagination are always parameters. */
function metric(name: string, from: string, options: MetricOptions) {
  const value =
    options.value === undefined
      ? `toFloat64(${options.numerator})/nullIf(${options.denominator},0)`
      : options.value;
  const unit =
    options.unit ?? (options.value === undefined ? "ratio" : "count");
  const group = DIMENSIONS.flatMap((dimension, index) =>
    options[dimension] === undefined ? [] : [String(index + 2)],
  ).join(",");
  return `SELECT '${name}' AS metric, CAST(toString(${options.date ?? "NULL"}),'Nullable(String)') AS date,
 CAST(${options.repo ?? "NULL"},'Nullable(String)') AS repo_name, CAST(${options.harness ?? "NULL"},'Nullable(String)') AS harness,
 CAST(${options.user ?? "NULL"},'Nullable(String)') AS user_id, CAST(${options.tool ?? "NULL"},'Nullable(String)') AS tool,
 CAST(${options.policy ?? "NULL"},'Nullable(String)') AS policy_id, CAST(${options.enabled ?? "NULL"},'Nullable(Bool)') AS tools_enabled,
 toFloat64(${value}) AS value, toFloat64(${options.numerator ?? "NULL"}) AS numerator,
 toFloat64(${options.denominator ?? "NULL"}) AS denominator, '${unit}' AS unit
 FROM ${from} ${options.where ? `WHERE ${options.where}` : ""}
 ${options.group ? `GROUP BY ${group}` : ""}`;
}
/**
 * Search-adoption aggregates over `api_ro.metrics_search_sessions` rows (`t`), keyed by
 * the shared metric names plus `sessions`, the rate's denominator. A metric is one
 * aggregate or the ratio of two.
 */
const searchAdoption = {
  sessions: { value: "count(*)" },
  agentcommons_search_sessions: {
    value: "countIf(t.agentcommons_search_calls>0)",
  },
  agentcommons_search_rate: {
    numerator: "agentcommons_search_sessions",
    denominator: "sessions",
  },
  agentcommons_search_calls: {
    value: "coalesce(sum(t.agentcommons_search_calls),0)",
  },
  repeat_agentcommons_search_calls: {
    value: "coalesce(sum(t.repeat_agentcommons_search_calls),0)",
  },
  subsequent_other_search_calls: {
    value: "coalesce(sum(t.subsequent_other_search_calls),0)",
  },
} satisfies Record<
  (typeof searchAdoptionMetricNames)[number] | "sessions",
  { value: string } | { numerator: string; denominator: string }
>;
const searchAdoptionSelect = Object.entries(searchAdoption)
  .flatMap(([column, definition]) =>
    "value" in definition
      ? [`toFloat64(${definition.value}) AS ${column}`]
      : [],
  )
  .join(",");
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
          metric(name, "w", {
            date: "week",
            numerator: count,
            denominator: "sessions",
          }),
        ),
      };
    case "health":
      return {
        cte: `s AS MATERIALIZED (SELECT * FROM api_ro.metrics_health WHERE ${filter("started_at")}), c AS MATERIALIZED (SELECT * FROM api_ro.metrics_capture WHERE ${filter("received_at")}), r AS MATERIALIZED (SELECT * FROM api_ro.metrics_redaction WHERE ${filter("created_at")})`,
        selects: [
          metric("capture_coverage", "api_ro.metrics_activity activity", {
            where: `${filter("activity.received_at", "activity.")} AND activity.received_at>=subtractDays(${bounds.to},7)`,
            numerator: "count(DISTINCT installation_id)",
            denominator: "(SELECT member_count FROM api_ro.metrics_members)",
          }),
          metric("sessions", "s", {
            value: "count(*)",
            date: "toDate(started_at)",
            repo: "repo_name",
            harness: "harness",
            user: "user_id",
            group: true,
          }),
          metric("capture_latency_seconds", "c", {
            value: "quantileExactInclusiveOrNull(0.5)(latency_seconds)",
            where: "latency_seconds>=0",
            unit: "seconds",
          }),
          metric("negative_capture_latency_records", "c", {
            value: "count(*)",
            where: "latency_seconds<0",
          }),
          metric("authorization_blocked_sessions", "s", {
            value: "count(*)",
            where: "authorization_blocked",
          }),
          metric("redaction_hits", "r", {
            value: "sum(count)",
            policy: "policy_id",
            group: true,
          }),
        ],
      };
    case "usage":
      return {
        cte: `a AS MATERIALIZED (SELECT * FROM api_ro.metrics_usage WHERE ${filter("ts")}), s AS MATERIALIZED (SELECT memory_assisted FROM api_ro.metrics_reuse_sessions WHERE ${filter("started_at")}), m AS MATERIALIZED (SELECT * FROM api_ro.metrics_mcp_calls WHERE ${filter("ts")}), d AS MATERIALIZED (SELECT * FROM api_ro.metrics_dashboard WHERE ${filter("ts")}), t AS MATERIALIZED (SELECT agentcommons_search_calls,repeat_agentcommons_search_calls,subsequent_other_search_calls FROM api_ro.metrics_search_sessions WHERE ${filter("started_at")}), adoption AS MATERIALIZED (SELECT ${searchAdoptionSelect} FROM t)`,
        selects: [
          ...searchAdoptionMetricNames.map((name) => {
            const definition = searchAdoption[name];
            return metric(
              name,
              "adoption",
              "value" in definition ? { value: name } : definition,
            );
          }),
          metric("mcp_calls", "m", {
            value: "count(*)",
            date: "toDate(ts)",
            tool: "action",
            group: true,
          }),
          metric("memory_assisted_rate", "s", {
            numerator: "countIf(memory_assisted)",
            denominator: "count(*)",
          }),
          metric("follow_through_rate", "a", {
            where: "action='search' AND hits IS NOT NULL",
            numerator: "countIf(followed_through)",
            denominator: "count(*)",
          }),
          metric("zero_result_rate", "a", {
            where: "action='search' AND hits IS NOT NULL",
            numerator: "countIf(hits=0)",
            denominator: "count(*)",
          }),
          metric("cross_user_hit_rate", "a", {
            where: "action='search' AND hits>0",
            numerator: "countIf(cross_user_hit)",
            denominator: "count(*)",
          }),
          metric("dashboard_weekly_actives", "d", {
            value: "count(DISTINCT d.user_id)",
            date: "toMonday(ts)",
            group: true,
          }),
          metric("dashboard_searches", "d", {
            value: "count(*)",
            where: "action='search'",
            date: "toDate(ts)",
            group: true,
          }),
          metric("dashboard_session_views", "d", {
            value: "count(*)",
            where: "action='get'",
            date: "toDate(ts)",
            group: true,
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
            metric(name, "s", {
              value: `avgOrNull(${column})`,
              repo: "repo_name",
              enabled: "tools_enabled",
              numerator: `sum(${column})`,
              denominator: "count(*)",
              unit,
              group: true,
            }),
          ),
          ...(
            [
              ["near_duplicate_rate", "near_duplicate"],
              ["rerun_loop_rate", "rerun_loop"],
              ["observed_commit_rate", "observed_commit"],
            ] as const
          ).map(([name, column]) =>
            metric(name, "s", {
              repo: "repo_name",
              enabled: "tools_enabled",
              numerator: `countIf(${column})`,
              denominator: "count(*)",
              group: true,
            }),
          ),
        ],
      };
  }
}
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
        const page = await offsetPage(
          this.dependencies.cursors,
          binding,
          cursor,
          request.limit,
          (offset, take) =>
            this.dependencies.readers.read(caller, async (client) => {
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
          LIMIT ${values.add(take)} OFFSET ${values.add(offset)}`,
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
            }),
        );
        return metricsOutputSchema.parse(page);
      },
      {
        describeResult: (result) => ({ rows: result.items.length }),
        permission: "admin",
      },
    );
  }
}
