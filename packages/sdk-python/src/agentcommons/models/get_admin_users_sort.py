from typing import Literal

GetAdminUsersSort = Literal[
    "created_at", "email", "last_seen_at", "name", "role", "suspended"
]

GET_ADMIN_USERS_SORT_VALUES: set[GetAdminUsersSort] = {
    "created_at",
    "email",
    "last_seen_at",
    "name",
    "role",
    "suspended",
}


def check_get_admin_users_sort(value: str) -> GetAdminUsersSort:
    if value in GET_ADMIN_USERS_SORT_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ADMIN_USERS_SORT_VALUES!r}"
    )
