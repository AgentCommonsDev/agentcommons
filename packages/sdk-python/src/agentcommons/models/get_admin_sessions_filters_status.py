from typing import Literal

GetAdminSessionsFiltersStatus = Literal["ACTIVE", "ENDED", "INACTIVE"]

GET_ADMIN_SESSIONS_FILTERS_STATUS_VALUES: set[GetAdminSessionsFiltersStatus] = {
    "ACTIVE",
    "ENDED",
    "INACTIVE",
}


def check_get_admin_sessions_filters_status(
    value: str,
) -> GetAdminSessionsFiltersStatus:
    if value in GET_ADMIN_SESSIONS_FILTERS_STATUS_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ADMIN_SESSIONS_FILTERS_STATUS_VALUES!r}"
    )
