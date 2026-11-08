from typing import Literal

GetAdminUsersFormat = Literal["csv", "json"]

GET_ADMIN_USERS_FORMAT_VALUES: set[GetAdminUsersFormat] = {
    "csv",
    "json",
}


def check_get_admin_users_format(value: str) -> GetAdminUsersFormat:
    if value in GET_ADMIN_USERS_FORMAT_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ADMIN_USERS_FORMAT_VALUES!r}"
    )
