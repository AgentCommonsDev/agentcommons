from typing import Literal

PostSearchBodyFiltersWhereItemType3Op = Literal["exists"]

POST_SEARCH_BODY_FILTERS_WHERE_ITEM_TYPE_3_OP_VALUES: set[
    PostSearchBodyFiltersWhereItemType3Op
] = {
    "exists",
}


def check_post_search_body_filters_where_item_type_3_op(
    value: str,
) -> PostSearchBodyFiltersWhereItemType3Op:
    if value in POST_SEARCH_BODY_FILTERS_WHERE_ITEM_TYPE_3_OP_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {POST_SEARCH_BODY_FILTERS_WHERE_ITEM_TYPE_3_OP_VALUES!r}"
    )
