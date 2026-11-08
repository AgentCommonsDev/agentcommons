from typing import Literal

GetAdminUsersOrder = Literal["asc", "desc"]

GET_ADMIN_USERS_ORDER_VALUES: set[GetAdminUsersOrder] = {
    "asc",
    "desc",
}


def check_get_admin_users_order(value: str) -> GetAdminUsersOrder:
    if value in GET_ADMIN_USERS_ORDER_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ADMIN_USERS_ORDER_VALUES!r}"
    )
