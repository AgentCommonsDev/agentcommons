import { z } from "zod";
import { compactMetadata, wireValue } from "./read-budget.js";
import {
  metricsGroupSchema,
  metricsInputSchema,
  metricsOutputSchema,
  metricRowSchema,
} from "@agentcommons/core";
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
  return `SELECT '${metric}'::text AS metric, ${options.date ?? "NULL"}::text AS date,
 ${options.repo ?? "NULL"}::text AS repo_name, ${options.harness ?? "NULL"}::text AS harness,
 ${options.user ?? "NULL"}::text AS user_id, ${options.tool ?? "NULL"}::text AS tool,
 ${options.policy ?? "NULL"}::text AS policy_id, ${options.enabled ?? "NULL"}::boolean AS tools_enabled,
 (${value})::double precision AS value, (${options.numerator ?? "NULL"})::double precision AS numerator,
 (${options.denominator ?? "NULL"})::double precision AS denominator, '${options.unit ?? "count"}'::text AS unit
 ${options.from ? `FROM ${options.from}` : ""} ${options.where ? `WHERE ${options.where}` : ""}
 ${options.group ? `GROUP BY ${options.group}` : ""}`;
}
const ratio = (count: string, denominator = "count(*)") =>
  `${count}::double precision/nullif(${denominator},0)`;
const filter = (date: string) =>
  `${date}>=$1::timestamptz AND ${date}<$2::timestamptz AND ($3::text IS NULL OR repo_name=$3)`;
const weekly = "date_trunc('week',started_at AT TIME ZONE 'UTC')::date";
function statements(group: z.infer<typeof metricsGroupSchema>) {
  switch (group) {
    case "reuse":
      return {
        cte: `s AS (SELECT * FROM api_ro.metrics_reuse_sessions WHERE ${filter("started_at")}), weeks AS (
        SELECT generate_series(date_trunc('week',$1::timestamptz AT TIME ZONE 'UTC'),date_trunc('week',($2::timestamptz-interval '1 microsecond') AT TIME ZONE 'UTC'),interval '1 week')::date AS week
      ), totals AS (SELECT ${weekly} AS week,count(*) AS sessions,count(*) FILTER(WHERE reused) AS reuse_sessions,
       count(*) FILTER(WHERE cross_user_reused) AS cross_user_reuse_sessions FROM s GROUP BY 1), w AS (
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
        cte: `s AS (SELECT * FROM api_ro.metrics_health WHERE ${filter("started_at")}), c AS (SELECT * FROM api_ro.metrics_capture WHERE ${filter("received_at")}), r AS (SELECT * FROM api_ro.metrics_redaction WHERE ${filter("created_at")})`,
        selects: [
          metric(
            "capture_coverage",
            ratio(
              "count(DISTINCT installation_id)",
              "(SELECT member_count FROM api_ro.metrics_members)",
            ),
            {
              from: "api_ro.metrics_activity",
              where: `${filter("received_at")} AND received_at>=$2::timestamptz-interval '7 days'`,
              numerator: "count(DISTINCT installation_id)",
              denominator: "(SELECT member_count FROM api_ro.metrics_members)",
              unit: "ratio",
            },
          ),
          metric("sessions", "count(*)", {
            from: "s",
            date: "(started_at AT TIME ZONE 'UTC')::date",
            repo: "repo_name",
            harness: "harness",
            user: "user_id",
            group: "2,3,4,5",
          }),
          metric(
            "capture_latency_seconds",
            "percentile_cont(0.5) WITHIN GROUP(ORDER BY latency_seconds)",
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
        cte: `a AS (SELECT * FROM api_ro.metrics_usage WHERE ${filter("ts")}), s AS (SELECT * FROM api_ro.metrics_reuse_sessions WHERE ${filter("started_at")}), m AS (SELECT * FROM api_ro.metrics_mcp_calls WHERE ${filter("ts")}), d AS (SELECT * FROM api_ro.metrics_dashboard WHERE ${filter("ts")})`,
        selects: [
          metric("mcp_calls", "count(*)", {
            from: "m",
            date: "(ts AT TIME ZONE 'UTC')::date",
            tool: "action",
            group: "2,6",
          }),
          metric(
            "memory_assisted_rate",
            ratio("count(*) FILTER(WHERE memory_assisted)"),
            {
              from: "s",
              numerator: "count(*) FILTER(WHERE memory_assisted)",
              denominator: "count(*)",
              unit: "ratio",
            },
          ),
          metric(
            "follow_through_rate",
            ratio("count(*) FILTER(WHERE followed_through)"),
            {
              from: "a",
              where: "action='search' AND hits IS NOT NULL",
              numerator: "count(*) FILTER(WHERE followed_through)",
              denominator: "count(*)",
              unit: "ratio",
            },
          ),
          metric("zero_result_rate", ratio("count(*) FILTER(WHERE hits=0)"), {
            from: "a",
            where: "action='search' AND hits IS NOT NULL",
            numerator: "count(*) FILTER(WHERE hits=0)",
            denominator: "count(*)",
            unit: "ratio",
          }),
          metric(
            "cross_user_hit_rate",
            ratio("count(*) FILTER(WHERE cross_user_hit)"),
            {
              from: "a",
              where: "action='search' AND hits>0",
              numerator: "count(*) FILTER(WHERE cross_user_hit)",
              denominator: "count(*)",
              unit: "ratio",
            },
          ),
          metric("dashboard_weekly_actives", "count(DISTINCT user_id)", {
            from: "d",
            date: "date_trunc('week',ts AT TIME ZONE 'UTC')::date",
            group: "2",
          }),
          metric("dashboard_searches", "count(*)", {
            from: "d",
            where: "action='search'",
            date: "(ts AT TIME ZONE 'UTC')::date",
            group: "2",
          }),
          metric("dashboard_session_views", "count(*)", {
            from: "d",
            where: "action='get'",
            date: "(ts AT TIME ZONE 'UTC')::date",
            group: "2",
          }),
        ],
      };
    case "outcomes":
      return {
        cte: `s AS (SELECT * FROM api_ro.metrics_outcomes WHERE ${filter("started_at")})`,
        selects: [
          ...(
            [
              ["tool_calls_per_session", "tool_call_count", "count"],
              ["tokens_per_session", "tokens", "tokens"],
              ["duration_seconds_per_session", "duration_seconds", "seconds"],
            ] as const
          ).map(([name, column, unit]) =>
            metric(name, `avg(${column})`, {
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
            metric(name, ratio(`count(*) FILTER(WHERE ${column})`), {
              from: "s",
              repo: "repo_name",
              enabled: "tools_enabled",
              numerator: `count(*) FILTER(WHERE ${column})`,
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
        const definition = statements(group);
        const rows = await this.dependencies.readers.read(
          caller,
          async (client) => {
            const values: unknown[] = [
              request.filters.date_from,
              request.filters.date_to,
              request.filters.repo_name ?? null,
              request.filters.metric ?? null,
              request.limit + 1,
            ];
            const offsetParameter = values.push(offset);
            const result = await client.query(
              `WITH ${definition.cte}, rows AS (${definition.selects.join(" UNION ALL ")}) SELECT * FROM rows
          WHERE ($4::text IS NULL OR metric=$4) ORDER BY ${request.sort ?? "date"} ${request.order} NULLS LAST,metric,date,repo_name,harness,user_id,tool,policy_id,tools_enabled
          LIMIT $5 OFFSET $${String(offsetParameter)}`,
              values,
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
