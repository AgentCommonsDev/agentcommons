from typing import Literal

PostSearchResponse200BlocksItemMessagesItemKind = Literal[
    "META", "TEXT", "THINKING", "TOOL_RESULT", "TOOL_USE"
]

POST_SEARCH_RESPONSE_200_BLOCKS_ITEM_MESSAGES_ITEM_KIND_VALUES: set[
    PostSearchResponse200BlocksItemMessagesItemKind
] = {
    "META",
    "TEXT",
    "THINKING",
    "TOOL_RESULT",
    "TOOL_USE",
}


def check_post_search_response_200_blocks_item_messages_item_kind(
    value: str,
) -> PostSearchResponse200BlocksItemMessagesItemKind:
    if value in POST_SEARCH_RESPONSE_200_BLOCKS_ITEM_MESSAGES_ITEM_KIND_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {POST_SEARCH_RESPONSE_200_BLOCKS_ITEM_MESSAGES_ITEM_KIND_VALUES!r}"
    )
