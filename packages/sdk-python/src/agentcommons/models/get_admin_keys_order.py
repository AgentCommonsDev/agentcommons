from typing import Literal

GetAdminKeysOrder = Literal["asc", "desc"]

GET_ADMIN_KEYS_ORDER_VALUES: set[GetAdminKeysOrder] = {
    "asc",
    "desc",
}


def check_get_admin_keys_order(value: str) -> GetAdminKeysOrder:
    if value in GET_ADMIN_KEYS_ORDER_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ADMIN_KEYS_ORDER_VALUES!r}"
    )
