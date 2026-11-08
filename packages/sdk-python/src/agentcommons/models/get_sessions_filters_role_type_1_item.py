from typing import Literal

GetSessionsFiltersRoleType1Item = Literal["ASSISTANT", "SYSTEM", "TOOL_RESULT", "USER"]

GET_SESSIONS_FILTERS_ROLE_TYPE_1_ITEM_VALUES: set[GetSessionsFiltersRoleType1Item] = {
    "ASSISTANT",
    "SYSTEM",
    "TOOL_RESULT",
    "USER",
}


def check_get_sessions_filters_role_type_1_item(
    value: str,
) -> GetSessionsFiltersRoleType1Item:
    if value in GET_SESSIONS_FILTERS_ROLE_TYPE_1_ITEM_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_SESSIONS_FILTERS_ROLE_TYPE_1_ITEM_VALUES!r}"
    )
