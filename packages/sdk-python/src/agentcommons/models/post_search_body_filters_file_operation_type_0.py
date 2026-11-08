from typing import Literal

PostSearchBodyFiltersFileOperationType0 = Literal["delete", "edit", "read", "write"]

POST_SEARCH_BODY_FILTERS_FILE_OPERATION_TYPE_0_VALUES: set[
    PostSearchBodyFiltersFileOperationType0
] = {
    "delete",
    "edit",
    "read",
    "write",
}


def check_post_search_body_filters_file_operation_type_0(
    value: str,
) -> PostSearchBodyFiltersFileOperationType0:
    if value in POST_SEARCH_BODY_FILTERS_FILE_OPERATION_TYPE_0_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {POST_SEARCH_BODY_FILTERS_FILE_OPERATION_TYPE_0_VALUES!r}"
    )
