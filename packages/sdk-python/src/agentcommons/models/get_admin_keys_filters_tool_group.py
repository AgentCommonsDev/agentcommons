from typing import Literal

GetAdminKeysFiltersToolGroup = Literal["administration", "dashboards"]

GET_ADMIN_KEYS_FILTERS_TOOL_GROUP_VALUES: set[GetAdminKeysFiltersToolGroup] = {
    "administration",
    "dashboards",
}


def check_get_admin_keys_filters_tool_group(value: str) -> GetAdminKeysFiltersToolGroup:
    if value in GET_ADMIN_KEYS_FILTERS_TOOL_GROUP_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ADMIN_KEYS_FILTERS_TOOL_GROUP_VALUES!r}"
    )
