from typing import Literal

GetSessionsFiltersRoleType0 = Literal["ASSISTANT", "SYSTEM", "TOOL_RESULT", "USER"]

GET_SESSIONS_FILTERS_ROLE_TYPE_0_VALUES: set[GetSessionsFiltersRoleType0] = {
    "ASSISTANT",
    "SYSTEM",
    "TOOL_RESULT",
    "USER",
}


def check_get_sessions_filters_role_type_0(value: str) -> GetSessionsFiltersRoleType0:
    if value in GET_SESSIONS_FILTERS_ROLE_TYPE_0_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_SESSIONS_FILTERS_ROLE_TYPE_0_VALUES!r}"
    )
