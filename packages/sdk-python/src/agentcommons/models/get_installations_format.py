from typing import Literal

GetInstallationsFormat = Literal["csv", "json"]

GET_INSTALLATIONS_FORMAT_VALUES: set[GetInstallationsFormat] = {
    "csv",
    "json",
}


def check_get_installations_format(value: str) -> GetInstallationsFormat:
    if value in GET_INSTALLATIONS_FORMAT_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_INSTALLATIONS_FORMAT_VALUES!r}"
    )
