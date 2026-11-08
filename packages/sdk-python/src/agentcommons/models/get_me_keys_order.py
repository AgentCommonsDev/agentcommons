from typing import Literal

GetMeKeysOrder = Literal["asc", "desc"]

GET_ME_KEYS_ORDER_VALUES: set[GetMeKeysOrder] = {
    "asc",
    "desc",
}


def check_get_me_keys_order(value: str) -> GetMeKeysOrder:
    if value in GET_ME_KEYS_ORDER_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ME_KEYS_ORDER_VALUES!r}"
    )
