from typing import Literal

GetSessionsIdReuseFormat = Literal["csv", "json"]

GET_SESSIONS_ID_REUSE_FORMAT_VALUES: set[GetSessionsIdReuseFormat] = {
    "csv",
    "json",
}


def check_get_sessions_id_reuse_format(value: str) -> GetSessionsIdReuseFormat:
    if value in GET_SESSIONS_ID_REUSE_FORMAT_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_SESSIONS_ID_REUSE_FORMAT_VALUES!r}"
    )
