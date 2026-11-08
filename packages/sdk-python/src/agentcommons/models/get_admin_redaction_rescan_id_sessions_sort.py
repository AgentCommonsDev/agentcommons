from typing import Literal

GetAdminRedactionRescanIdSessionsSort = Literal["processed_at", "redaction_count"]

GET_ADMIN_REDACTION_RESCAN_ID_SESSIONS_SORT_VALUES: set[
    GetAdminRedactionRescanIdSessionsSort
] = {
    "processed_at",
    "redaction_count",
}


def check_get_admin_redaction_rescan_id_sessions_sort(
    value: str,
) -> GetAdminRedactionRescanIdSessionsSort:
    if value in GET_ADMIN_REDACTION_RESCAN_ID_SESSIONS_SORT_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ADMIN_REDACTION_RESCAN_ID_SESSIONS_SORT_VALUES!r}"
    )
