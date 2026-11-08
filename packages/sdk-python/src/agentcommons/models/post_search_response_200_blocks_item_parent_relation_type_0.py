from typing import Literal

PostSearchResponse200BlocksItemParentRelationType0 = Literal[
    "FORK", "SPAWNED", "SUBAGENT"
]

POST_SEARCH_RESPONSE_200_BLOCKS_ITEM_PARENT_RELATION_TYPE_0_VALUES: set[
    PostSearchResponse200BlocksItemParentRelationType0
] = {
    "FORK",
    "SPAWNED",
    "SUBAGENT",
}


def check_post_search_response_200_blocks_item_parent_relation_type_0(
    value: str,
) -> PostSearchResponse200BlocksItemParentRelationType0:
    if value in POST_SEARCH_RESPONSE_200_BLOCKS_ITEM_PARENT_RELATION_TYPE_0_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {POST_SEARCH_RESPONSE_200_BLOCKS_ITEM_PARENT_RELATION_TYPE_0_VALUES!r}"
    )
