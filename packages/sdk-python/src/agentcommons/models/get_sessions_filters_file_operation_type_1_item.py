from typing import Literal

GetSessionsFiltersFileOperationType1Item = Literal["delete", "edit", "read", "write"]

GET_SESSIONS_FILTERS_FILE_OPERATION_TYPE_1_ITEM_VALUES: set[
    GetSessionsFiltersFileOperationType1Item
] = {
    "delete",
    "edit",
    "read",
    "write",
}


def check_get_sessions_filters_file_operation_type_1_item(
    value: str,
) -> GetSessionsFiltersFileOperationType1Item:
    if value in GET_SESSIONS_FILTERS_FILE_OPERATION_TYPE_1_ITEM_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_SESSIONS_FILTERS_FILE_OPERATION_TYPE_1_ITEM_VALUES!r}"
    )
