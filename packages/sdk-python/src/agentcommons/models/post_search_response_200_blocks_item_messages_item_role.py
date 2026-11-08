from typing import Literal

PostSearchResponse200BlocksItemMessagesItemRole = Literal[
    "ASSISTANT", "SYSTEM", "TOOL_RESULT", "USER"
]

POST_SEARCH_RESPONSE_200_BLOCKS_ITEM_MESSAGES_ITEM_ROLE_VALUES: set[
    PostSearchResponse200BlocksItemMessagesItemRole
] = {
    "ASSISTANT",
    "SYSTEM",
    "TOOL_RESULT",
    "USER",
}


def check_post_search_response_200_blocks_item_messages_item_role(
    value: str,
) -> PostSearchResponse200BlocksItemMessagesItemRole:
    if value in POST_SEARCH_RESPONSE_200_BLOCKS_ITEM_MESSAGES_ITEM_ROLE_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {POST_SEARCH_RESPONSE_200_BLOCKS_ITEM_MESSAGES_ITEM_ROLE_VALUES!r}"
    )
