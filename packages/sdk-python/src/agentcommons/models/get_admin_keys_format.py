from typing import Literal

GetAdminKeysFormat = Literal["csv", "json"]

GET_ADMIN_KEYS_FORMAT_VALUES: set[GetAdminKeysFormat] = {
    "csv",
    "json",
}


def check_get_admin_keys_format(value: str) -> GetAdminKeysFormat:
    if value in GET_ADMIN_KEYS_FORMAT_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ADMIN_KEYS_FORMAT_VALUES!r}"
    )
