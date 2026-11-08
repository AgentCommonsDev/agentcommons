from typing import Literal

GetAdminSessionsSort = Literal[
    "harness",
    "last_activity_at",
    "purged_at",
    "started_at",
    "status",
    "user_email",
    "visibility",
]

GET_ADMIN_SESSIONS_SORT_VALUES: set[GetAdminSessionsSort] = {
    "harness",
    "last_activity_at",
    "purged_at",
    "started_at",
    "status",
    "user_email",
    "visibility",
}


def check_get_admin_sessions_sort(value: str) -> GetAdminSessionsSort:
    if value in GET_ADMIN_SESSIONS_SORT_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ADMIN_SESSIONS_SORT_VALUES!r}"
    )
