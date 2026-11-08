from typing import Literal

PostSearchBodyFiltersWhereItemType2Op = Literal["starts_with"]

POST_SEARCH_BODY_FILTERS_WHERE_ITEM_TYPE_2_OP_VALUES: set[
    PostSearchBodyFiltersWhereItemType2Op
] = {
    "starts_with",
}


def check_post_search_body_filters_where_item_type_2_op(
    value: str,
) -> PostSearchBodyFiltersWhereItemType2Op:
    if value in POST_SEARCH_BODY_FILTERS_WHERE_ITEM_TYPE_2_OP_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {POST_SEARCH_BODY_FILTERS_WHERE_ITEM_TYPE_2_OP_VALUES!r}"
    )
