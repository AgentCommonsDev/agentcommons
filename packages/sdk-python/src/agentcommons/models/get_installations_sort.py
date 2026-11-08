from typing import Literal

GetInstallationsSort = Literal[
    "arch",
    "first_seen_at",
    "hostname",
    "last_seen_at",
    "os_user",
    "platform",
    "session_count",
    "tools_enabled",
]

GET_INSTALLATIONS_SORT_VALUES: set[GetInstallationsSort] = {
    "arch",
    "first_seen_at",
    "hostname",
    "last_seen_at",
    "os_user",
    "platform",
    "session_count",
    "tools_enabled",
}


def check_get_installations_sort(value: str) -> GetInstallationsSort:
    if value in GET_INSTALLATIONS_SORT_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_INSTALLATIONS_SORT_VALUES!r}"
    )
