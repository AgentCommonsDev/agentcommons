from typing import Literal

GetAdminInstallationsFormat = Literal["csv", "json"]

GET_ADMIN_INSTALLATIONS_FORMAT_VALUES: set[GetAdminInstallationsFormat] = {
    "csv",
    "json",
}


def check_get_admin_installations_format(value: str) -> GetAdminInstallationsFormat:
    if value in GET_ADMIN_INSTALLATIONS_FORMAT_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ADMIN_INSTALLATIONS_FORMAT_VALUES!r}"
    )
