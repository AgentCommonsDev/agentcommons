from typing import Literal

GetAdminSessionsFormat = Literal["csv", "json"]

GET_ADMIN_SESSIONS_FORMAT_VALUES: set[GetAdminSessionsFormat] = {
    "csv",
    "json",
}


def check_get_admin_sessions_format(value: str) -> GetAdminSessionsFormat:
    if value in GET_ADMIN_SESSIONS_FORMAT_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ADMIN_SESSIONS_FORMAT_VALUES!r}"
    )
