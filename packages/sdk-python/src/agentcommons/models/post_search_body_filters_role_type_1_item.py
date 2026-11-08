from typing import Literal

PostSearchBodyFiltersRoleType1Item = Literal[
    "ASSISTANT", "SYSTEM", "TOOL_RESULT", "USER"
]

POST_SEARCH_BODY_FILTERS_ROLE_TYPE_1_ITEM_VALUES: set[
    PostSearchBodyFiltersRoleType1Item
] = {
    "ASSISTANT",
    "SYSTEM",
    "TOOL_RESULT",
    "USER",
}


def check_post_search_body_filters_role_type_1_item(
    value: str,
) -> PostSearchBodyFiltersRoleType1Item:
    if value in POST_SEARCH_BODY_FILTERS_ROLE_TYPE_1_ITEM_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {POST_SEARCH_BODY_FILTERS_ROLE_TYPE_1_ITEM_VALUES!r}"
    )
