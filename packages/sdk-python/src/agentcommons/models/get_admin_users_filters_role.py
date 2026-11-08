from typing import Literal

GetAdminUsersFiltersRole = Literal["admin", "member", "owner"]

GET_ADMIN_USERS_FILTERS_ROLE_VALUES: set[GetAdminUsersFiltersRole] = {
    "admin",
    "member",
    "owner",
}


def check_get_admin_users_filters_role(value: str) -> GetAdminUsersFiltersRole:
    if value in GET_ADMIN_USERS_FILTERS_ROLE_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ADMIN_USERS_FILTERS_ROLE_VALUES!r}"
    )
