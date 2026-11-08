from typing import Literal

GetMeKeysFormat = Literal["csv", "json"]

GET_ME_KEYS_FORMAT_VALUES: set[GetMeKeysFormat] = {
    "csv",
    "json",
}


def check_get_me_keys_format(value: str) -> GetMeKeysFormat:
    if value in GET_ME_KEYS_FORMAT_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ME_KEYS_FORMAT_VALUES!r}"
    )
