from typing import Literal

PostSearchBodyFiltersWhereItemType1Op = Literal["contains"]

POST_SEARCH_BODY_FILTERS_WHERE_ITEM_TYPE_1_OP_VALUES: set[
    PostSearchBodyFiltersWhereItemType1Op
] = {
    "contains",
}


def check_post_search_body_filters_where_item_type_1_op(
    value: str,
) -> PostSearchBodyFiltersWhereItemType1Op:
    if value in POST_SEARCH_BODY_FILTERS_WHERE_ITEM_TYPE_1_OP_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {POST_SEARCH_BODY_FILTERS_WHERE_ITEM_TYPE_1_OP_VALUES!r}"
    )
