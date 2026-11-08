from typing import Literal

GetAdminMetricsGroupSort = Literal[
    "date",
    "harness",
    "metric",
    "repo_name",
    "tool",
    "tools_enabled",
    "user_id",
    "value",
]

GET_ADMIN_METRICS_GROUP_SORT_VALUES: set[GetAdminMetricsGroupSort] = {
    "date",
    "harness",
    "metric",
    "repo_name",
    "tool",
    "tools_enabled",
    "user_id",
    "value",
}


def check_get_admin_metrics_group_sort(value: str) -> GetAdminMetricsGroupSort:
    if value in GET_ADMIN_METRICS_GROUP_SORT_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ADMIN_METRICS_GROUP_SORT_VALUES!r}"
    )
