from typing import Literal

GetAdminMetricsGroupOrder = Literal["asc", "desc"]

GET_ADMIN_METRICS_GROUP_ORDER_VALUES: set[GetAdminMetricsGroupOrder] = {
    "asc",
    "desc",
}


def check_get_admin_metrics_group_order(value: str) -> GetAdminMetricsGroupOrder:
    if value in GET_ADMIN_METRICS_GROUP_ORDER_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ADMIN_METRICS_GROUP_ORDER_VALUES!r}"
    )
