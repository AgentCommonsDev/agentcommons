from typing import Literal

GetAdminMetricsGroupFiltersMetric = Literal[
    "agentcommons_search_calls",
    "agentcommons_search_rate",
    "agentcommons_search_sessions",
    "authorization_blocked_sessions",
    "capture_coverage",
    "capture_latency_seconds",
    "cross_user_hit_rate",
    "cross_user_reuse_rate",
    "dashboard_searches",
    "dashboard_session_views",
    "dashboard_weekly_actives",
    "duration_seconds_per_session",
    "follow_through_rate",
    "mcp_calls",
    "memory_assisted_rate",
    "near_duplicate_rate",
    "negative_capture_latency_records",
    "observed_commit_rate",
    "redaction_hits",
    "repeat_agentcommons_search_calls",
    "rerun_loop_rate",
    "reuse_rate",
    "sessions",
    "tokens_per_session",
    "tool_calls_per_session",
    "zero_result_rate",
]

GET_ADMIN_METRICS_GROUP_FILTERS_METRIC_VALUES: set[
    GetAdminMetricsGroupFiltersMetric
] = {
    "agentcommons_search_calls",
    "agentcommons_search_rate",
    "agentcommons_search_sessions",
    "authorization_blocked_sessions",
    "capture_coverage",
    "capture_latency_seconds",
    "cross_user_hit_rate",
    "cross_user_reuse_rate",
    "dashboard_searches",
    "dashboard_session_views",
    "dashboard_weekly_actives",
    "duration_seconds_per_session",
    "follow_through_rate",
    "mcp_calls",
    "memory_assisted_rate",
    "near_duplicate_rate",
    "negative_capture_latency_records",
    "observed_commit_rate",
    "redaction_hits",
    "repeat_agentcommons_search_calls",
    "rerun_loop_rate",
    "reuse_rate",
    "sessions",
    "tokens_per_session",
    "tool_calls_per_session",
    "zero_result_rate",
}


def check_get_admin_metrics_group_filters_metric(
    value: str,
) -> GetAdminMetricsGroupFiltersMetric:
    if value in GET_ADMIN_METRICS_GROUP_FILTERS_METRIC_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ADMIN_METRICS_GROUP_FILTERS_METRIC_VALUES!r}"
    )
