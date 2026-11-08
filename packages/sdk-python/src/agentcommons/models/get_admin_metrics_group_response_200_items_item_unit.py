from typing import Literal

GetAdminMetricsGroupResponse200ItemsItemUnit = Literal[
    "count", "milliseconds", "ratio", "seconds", "tokens", "usd"
]

GET_ADMIN_METRICS_GROUP_RESPONSE_200_ITEMS_ITEM_UNIT_VALUES: set[
    GetAdminMetricsGroupResponse200ItemsItemUnit
] = {
    "count",
    "milliseconds",
    "ratio",
    "seconds",
    "tokens",
    "usd",
}


def check_get_admin_metrics_group_response_200_items_item_unit(
    value: str,
) -> GetAdminMetricsGroupResponse200ItemsItemUnit:
    if value in GET_ADMIN_METRICS_GROUP_RESPONSE_200_ITEMS_ITEM_UNIT_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ADMIN_METRICS_GROUP_RESPONSE_200_ITEMS_ITEM_UNIT_VALUES!r}"
    )
