from typing import Literal

GetAdminMetricsGroupFormat = Literal["csv", "json"]

GET_ADMIN_METRICS_GROUP_FORMAT_VALUES: set[GetAdminMetricsGroupFormat] = {
    "csv",
    "json",
}


def check_get_admin_metrics_group_format(value: str) -> GetAdminMetricsGroupFormat:
    if value in GET_ADMIN_METRICS_GROUP_FORMAT_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ADMIN_METRICS_GROUP_FORMAT_VALUES!r}"
    )
