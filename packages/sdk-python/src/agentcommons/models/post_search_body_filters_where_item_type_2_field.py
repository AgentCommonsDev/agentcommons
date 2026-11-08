from typing import Literal

PostSearchBodyFiltersWhereItemType2Field = Literal[
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

POST_SEARCH_BODY_FILTERS_WHERE_ITEM_TYPE_2_FIELD_VALUES: set[
    PostSearchBodyFiltersWhereItemType2Field
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


def check_post_search_body_filters_where_item_type_2_field(
    value: str,
) -> PostSearchBodyFiltersWhereItemType2Field:
    if value in POST_SEARCH_BODY_FILTERS_WHERE_ITEM_TYPE_2_FIELD_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {POST_SEARCH_BODY_FILTERS_WHERE_ITEM_TYPE_2_FIELD_VALUES!r}"
    )
