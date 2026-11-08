from typing import Literal

PostSearchResponse200BlocksItemHarness = Literal[
    "CLAUDE_CODE", "CODEX", "GEMINI_CLI", "PI"
]

POST_SEARCH_RESPONSE_200_BLOCKS_ITEM_HARNESS_VALUES: set[
    PostSearchResponse200BlocksItemHarness
] = {
    "CLAUDE_CODE",
    "CODEX",
    "GEMINI_CLI",
    "PI",
}


def check_post_search_response_200_blocks_item_harness(
    value: str,
) -> PostSearchResponse200BlocksItemHarness:
    if value in POST_SEARCH_RESPONSE_200_BLOCKS_ITEM_HARNESS_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {POST_SEARCH_RESPONSE_200_BLOCKS_ITEM_HARNESS_VALUES!r}"
    )
