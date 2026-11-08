from typing import Literal

PostSearchBodyFiltersRoleType0 = Literal["ASSISTANT", "SYSTEM", "TOOL_RESULT", "USER"]

POST_SEARCH_BODY_FILTERS_ROLE_TYPE_0_VALUES: set[PostSearchBodyFiltersRoleType0] = {
    "ASSISTANT",
    "SYSTEM",
    "TOOL_RESULT",
    "USER",
}


def check_post_search_body_filters_role_type_0(
    value: str,
) -> PostSearchBodyFiltersRoleType0:
    if value in POST_SEARCH_BODY_FILTERS_ROLE_TYPE_0_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {POST_SEARCH_BODY_FILTERS_ROLE_TYPE_0_VALUES!r}"
    )
