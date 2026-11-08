from typing import Literal

GetSessionsFormat = Literal["csv", "json"]

GET_SESSIONS_FORMAT_VALUES: set[GetSessionsFormat] = {
    "csv",
    "json",
}


def check_get_sessions_format(value: str) -> GetSessionsFormat:
    if value in GET_SESSIONS_FORMAT_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_SESSIONS_FORMAT_VALUES!r}"
    )
