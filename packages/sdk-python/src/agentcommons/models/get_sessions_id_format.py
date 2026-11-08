from typing import Literal

GetSessionsIdFormat = Literal["csv", "json"]

GET_SESSIONS_ID_FORMAT_VALUES: set[GetSessionsIdFormat] = {
    "csv",
    "json",
}


def check_get_sessions_id_format(value: str) -> GetSessionsIdFormat:
    if value in GET_SESSIONS_ID_FORMAT_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_SESSIONS_ID_FORMAT_VALUES!r}"
    )
