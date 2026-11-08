from typing import Literal

PostSearchBodyFiltersWhereItemType0Field = Literal[
    "branch",
    "content",
    "harness",
    "kind",
    "model",
    "repo_name",
    "role",
    "status",
    "title",
    "tool_input",
    "tool_name",
    "tool_use_id",
    "user_email",
]

POST_SEARCH_BODY_FILTERS_WHERE_ITEM_TYPE_0_FIELD_VALUES: set[
    PostSearchBodyFiltersWhereItemType0Field
] = {
    "branch",
    "content",
    "harness",
    "kind",
    "model",
    "repo_name",
    "role",
    "status",
    "title",
    "tool_input",
    "tool_name",
    "tool_use_id",
    "user_email",
}


def check_post_search_body_filters_where_item_type_0_field(
    value: str,
) -> PostSearchBodyFiltersWhereItemType0Field:
    if value in POST_SEARCH_BODY_FILTERS_WHERE_ITEM_TYPE_0_FIELD_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {POST_SEARCH_BODY_FILTERS_WHERE_ITEM_TYPE_0_FIELD_VALUES!r}"
    )
