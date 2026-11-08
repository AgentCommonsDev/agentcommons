from typing import Literal

GetAdminSessionsOrder = Literal["asc", "desc"]

GET_ADMIN_SESSIONS_ORDER_VALUES: set[GetAdminSessionsOrder] = {
    "asc",
    "desc",
}


def check_get_admin_sessions_order(value: str) -> GetAdminSessionsOrder:
    if value in GET_ADMIN_SESSIONS_ORDER_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ADMIN_SESSIONS_ORDER_VALUES!r}"
    )
