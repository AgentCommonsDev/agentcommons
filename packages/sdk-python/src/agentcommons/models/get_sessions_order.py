from typing import Literal

GetSessionsOrder = Literal["asc", "desc"]

GET_SESSIONS_ORDER_VALUES: set[GetSessionsOrder] = {
    "asc",
    "desc",
}


def check_get_sessions_order(value: str) -> GetSessionsOrder:
    if value in GET_SESSIONS_ORDER_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_SESSIONS_ORDER_VALUES!r}"
    )
