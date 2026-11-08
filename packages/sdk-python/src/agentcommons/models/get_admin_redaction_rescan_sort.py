from typing import Literal

GetAdminRedactionRescanSort = Literal[
    "created_at", "redaction_count", "state", "total_sessions"
]

GET_ADMIN_REDACTION_RESCAN_SORT_VALUES: set[GetAdminRedactionRescanSort] = {
    "created_at",
    "redaction_count",
    "state",
    "total_sessions",
}


def check_get_admin_redaction_rescan_sort(value: str) -> GetAdminRedactionRescanSort:
    if value in GET_ADMIN_REDACTION_RESCAN_SORT_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ADMIN_REDACTION_RESCAN_SORT_VALUES!r}"
    )
