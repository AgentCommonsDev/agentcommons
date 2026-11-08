from typing import Literal

GetSessionsFiltersWhereItemType3Field = Literal[
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

GET_SESSIONS_FILTERS_WHERE_ITEM_TYPE_3_FIELD_VALUES: set[
    GetSessionsFiltersWhereItemType3Field
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


def check_get_sessions_filters_where_item_type_3_field(
    value: str,
) -> GetSessionsFiltersWhereItemType3Field:
    if value in GET_SESSIONS_FILTERS_WHERE_ITEM_TYPE_3_FIELD_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_SESSIONS_FILTERS_WHERE_ITEM_TYPE_3_FIELD_VALUES!r}"
    )
