from typing import Literal

GetSessionsIdReuseDirection = Literal["by", "from"]

GET_SESSIONS_ID_REUSE_DIRECTION_VALUES: set[GetSessionsIdReuseDirection] = {
    "by",
    "from",
}


def check_get_sessions_id_reuse_direction(value: str) -> GetSessionsIdReuseDirection:
    if value in GET_SESSIONS_ID_REUSE_DIRECTION_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_SESSIONS_ID_REUSE_DIRECTION_VALUES!r}"
    )
