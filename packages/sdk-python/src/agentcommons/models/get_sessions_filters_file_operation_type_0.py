from typing import Literal

GetSessionsFiltersFileOperationType0 = Literal["delete", "edit", "read", "write"]

GET_SESSIONS_FILTERS_FILE_OPERATION_TYPE_0_VALUES: set[
    GetSessionsFiltersFileOperationType0
] = {
    "delete",
    "edit",
    "read",
    "write",
}


def check_get_sessions_filters_file_operation_type_0(
    value: str,
) -> GetSessionsFiltersFileOperationType0:
    if value in GET_SESSIONS_FILTERS_FILE_OPERATION_TYPE_0_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_SESSIONS_FILTERS_FILE_OPERATION_TYPE_0_VALUES!r}"
    )
