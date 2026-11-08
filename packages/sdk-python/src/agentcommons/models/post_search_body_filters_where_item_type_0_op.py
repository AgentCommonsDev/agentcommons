from typing import Literal

PostSearchBodyFiltersWhereItemType0Op = Literal["eq"]

POST_SEARCH_BODY_FILTERS_WHERE_ITEM_TYPE_0_OP_VALUES: set[
    PostSearchBodyFiltersWhereItemType0Op
] = {
    "eq",
}


def check_post_search_body_filters_where_item_type_0_op(
    value: str,
) -> PostSearchBodyFiltersWhereItemType0Op:
    if value in POST_SEARCH_BODY_FILTERS_WHERE_ITEM_TYPE_0_OP_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {POST_SEARCH_BODY_FILTERS_WHERE_ITEM_TYPE_0_OP_VALUES!r}"
    )
