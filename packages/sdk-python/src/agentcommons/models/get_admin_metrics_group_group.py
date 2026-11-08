from typing import Literal

GetAdminMetricsGroupGroup = Literal["health", "outcomes", "reuse", "usage"]

GET_ADMIN_METRICS_GROUP_GROUP_VALUES: set[GetAdminMetricsGroupGroup] = {
    "health",
    "outcomes",
    "reuse",
    "usage",
}


def check_get_admin_metrics_group_group(value: str) -> GetAdminMetricsGroupGroup:
    if value in GET_ADMIN_METRICS_GROUP_GROUP_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ADMIN_METRICS_GROUP_GROUP_VALUES!r}"
    )
