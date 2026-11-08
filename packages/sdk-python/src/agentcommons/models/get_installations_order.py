from typing import Literal

GetInstallationsOrder = Literal["asc", "desc"]

GET_INSTALLATIONS_ORDER_VALUES: set[GetInstallationsOrder] = {
    "asc",
    "desc",
}


def check_get_installations_order(value: str) -> GetInstallationsOrder:
    if value in GET_INSTALLATIONS_ORDER_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_INSTALLATIONS_ORDER_VALUES!r}"
    )
