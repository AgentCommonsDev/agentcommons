import { z } from "zod";
import {
  createListInputSchema,
  opaqueCursorSchema,
  utcDateTimeSchema,
  metricUnitSchema,
} from "./common.js";

export const searchAdoptionMetricNames = [
  "agentcommons_search_sessions",
  "agentcommons_search_rate",
  "agentcommons_search_calls",
  "repeat_agentcommons_search_calls",
  "subsequent_other_search_calls",
] as const;

export const metricGroups = {
  reuse: ["reuse_rate", "cross_user_reuse_rate"],
  health: [
    "capture_coverage",
    "sessions",
    "capture_latency_seconds",
    "negative_capture_latency_records",
    "authorization_blocked_sessions",
    "redaction_hits",
  ],
  usage: [
    ...searchAdoptionMetricNames,
    "mcp_calls",
    "memory_assisted_rate",
    "follow_through_rate",
    "zero_result_rate",
    "cross_user_hit_rate",
    "dashboard_weekly_actives",
    "dashboard_searches",
    "dashboard_session_views",
  ],
  outcomes: [
    "tool_calls_per_session",
    "tokens_per_session",
    "duration_seconds_per_session",
    "near_duplicate_rate",
    "rerun_loop_rate",
    "observed_commit_rate",
  ],
} as const;
export const metricsGroupSchema = z.enum([
  "reuse",
  "health",
  "usage",
  "outcomes",
]);
export const metricNameSchema = z.enum([
  ...metricGroups.reuse,
  ...metricGroups.health,
  ...metricGroups.usage,
  ...metricGroups.outcomes,
]);
export const metricsInputSchema = createListInputSchema([
  "date",
  "metric",
  "value",
  "repo_name",
  "user_id",
  "harness",
  "tool",
  "tools_enabled",
])
  .extend({
    filters: z.strictObject({
      date_from: utcDateTimeSchema,
      date_to: utcDateTimeSchema,
      repo_name: z.string().min(1).optional(),
      metric: metricNameSchema.optional(),
    }),
  })
  .superRefine((value, context) => {
    if (
      Date.parse(value.filters.date_from) >= Date.parse(value.filters.date_to)
    )
      context.addIssue({
        code: "custom",
        path: ["filters", "date_to"],
        message: "The end date must follow the start date.",
      });
  });
export const metricRowSchema = z.strictObject({
  metric: metricNameSchema,
  date: z.iso.date().nullable(),
  repo_name: z.string().nullable(),
  harness: z.string().nullable(),
  user_id: z.string().nullable(),
  tool: z.string().nullable(),
  policy_id: z.string().nullable(),
  tools_enabled: z.boolean().nullable(),
  value: z.number().nullable(),
  numerator: z.number().nullable(),
  denominator: z.number().nullable(),
  unit: metricUnitSchema,
  truncated_fields: z.array(z.string()).default([]),
});
export const metricsOutputSchema = z.strictObject({
  items: z.array(metricRowSchema),
  cursor: opaqueCursorSchema,
});
export type MetricRow = z.infer<typeof metricRowSchema>;
