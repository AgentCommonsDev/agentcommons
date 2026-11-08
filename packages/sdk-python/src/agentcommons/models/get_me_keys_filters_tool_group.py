from typing import Literal

GetMeKeysFiltersToolGroup = Literal["administration", "dashboards"]

GET_ME_KEYS_FILTERS_TOOL_GROUP_VALUES: set[GetMeKeysFiltersToolGroup] = {
    "administration",
    "dashboards",
}


def check_get_me_keys_filters_tool_group(value: str) -> GetMeKeysFiltersToolGroup:
    if value in GET_ME_KEYS_FILTERS_TOOL_GROUP_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ME_KEYS_FILTERS_TOOL_GROUP_VALUES!r}"
    )
