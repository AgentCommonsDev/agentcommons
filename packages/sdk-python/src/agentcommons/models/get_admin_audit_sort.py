from typing import Literal

GetAdminAuditSort = Literal[
    "action", "duration_ms", "request_id", "status_code", "transport", "ts", "user_id"
]

GET_ADMIN_AUDIT_SORT_VALUES: set[GetAdminAuditSort] = {
    "action",
    "duration_ms",
    "request_id",
    "status_code",
    "transport",
    "ts",
    "user_id",
}


def check_get_admin_audit_sort(value: str) -> GetAdminAuditSort:
    if value in GET_ADMIN_AUDIT_SORT_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ADMIN_AUDIT_SORT_VALUES!r}"
    )
