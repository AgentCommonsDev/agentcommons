from typing import Literal

GetSessionsIdReuseSort = Literal[
    "read_at", "reader_email", "source_title", "target_title"
]

GET_SESSIONS_ID_REUSE_SORT_VALUES: set[GetSessionsIdReuseSort] = {
    "read_at",
    "reader_email",
    "source_title",
    "target_title",
}


def check_get_sessions_id_reuse_sort(value: str) -> GetSessionsIdReuseSort:
    if value in GET_SESSIONS_ID_REUSE_SORT_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_SESSIONS_ID_REUSE_SORT_VALUES!r}"
    )
