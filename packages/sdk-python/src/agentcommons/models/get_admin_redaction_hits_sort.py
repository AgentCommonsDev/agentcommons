from typing import Literal

GetAdminRedactionHitsSort = Literal["count", "redacted_at", "seq"]

GET_ADMIN_REDACTION_HITS_SORT_VALUES: set[GetAdminRedactionHitsSort] = {
    "count",
    "redacted_at",
    "seq",
}


def check_get_admin_redaction_hits_sort(value: str) -> GetAdminRedactionHitsSort:
    if value in GET_ADMIN_REDACTION_HITS_SORT_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ADMIN_REDACTION_HITS_SORT_VALUES!r}"
    )
