from typing import Literal

GetAdminInstallationsOrder = Literal["asc", "desc"]

GET_ADMIN_INSTALLATIONS_ORDER_VALUES: set[GetAdminInstallationsOrder] = {
    "asc",
    "desc",
}


def check_get_admin_installations_order(value: str) -> GetAdminInstallationsOrder:
    if value in GET_ADMIN_INSTALLATIONS_ORDER_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ADMIN_INSTALLATIONS_ORDER_VALUES!r}"
    )
