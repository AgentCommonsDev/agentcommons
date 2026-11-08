from typing import Literal

GetAdminInstallationsSort = Literal[
    "first_seen_at", "hostname", "last_seen_at", "tools_enabled", "up_to_date"
]

GET_ADMIN_INSTALLATIONS_SORT_VALUES: set[GetAdminInstallationsSort] = {
    "first_seen_at",
    "hostname",
    "last_seen_at",
    "tools_enabled",
    "up_to_date",
}


def check_get_admin_installations_sort(value: str) -> GetAdminInstallationsSort:
    if value in GET_ADMIN_INSTALLATIONS_SORT_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ADMIN_INSTALLATIONS_SORT_VALUES!r}"
    )
