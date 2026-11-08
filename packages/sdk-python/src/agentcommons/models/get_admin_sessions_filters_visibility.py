from typing import Literal

GetAdminSessionsFiltersVisibility = Literal["PRIVATE", "PUBLIC"]

GET_ADMIN_SESSIONS_FILTERS_VISIBILITY_VALUES: set[GetAdminSessionsFiltersVisibility] = {
    "PRIVATE",
    "PUBLIC",
}


def check_get_admin_sessions_filters_visibility(
    value: str,
) -> GetAdminSessionsFiltersVisibility:
    if value in GET_ADMIN_SESSIONS_FILTERS_VISIBILITY_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ADMIN_SESSIONS_FILTERS_VISIBILITY_VALUES!r}"
    )
