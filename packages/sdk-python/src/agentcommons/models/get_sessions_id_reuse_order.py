from typing import Literal

GetSessionsIdReuseOrder = Literal["asc", "desc"]

GET_SESSIONS_ID_REUSE_ORDER_VALUES: set[GetSessionsIdReuseOrder] = {
    "asc",
    "desc",
}


def check_get_sessions_id_reuse_order(value: str) -> GetSessionsIdReuseOrder:
    if value in GET_SESSIONS_ID_REUSE_ORDER_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_SESSIONS_ID_REUSE_ORDER_VALUES!r}"
    )
