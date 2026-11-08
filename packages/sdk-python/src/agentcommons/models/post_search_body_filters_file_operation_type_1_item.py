from typing import Literal

PostSearchBodyFiltersFileOperationType1Item = Literal["delete", "edit", "read", "write"]

POST_SEARCH_BODY_FILTERS_FILE_OPERATION_TYPE_1_ITEM_VALUES: set[
    PostSearchBodyFiltersFileOperationType1Item
] = {
    "delete",
    "edit",
    "read",
    "write",
}


def check_post_search_body_filters_file_operation_type_1_item(
    value: str,
) -> PostSearchBodyFiltersFileOperationType1Item:
    if value in POST_SEARCH_BODY_FILTERS_FILE_OPERATION_TYPE_1_ITEM_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {POST_SEARCH_BODY_FILTERS_FILE_OPERATION_TYPE_1_ITEM_VALUES!r}"
    )
