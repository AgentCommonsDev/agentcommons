from typing import Literal

GetSessionsIdReuseResponse200ItemsItemReaderHarness = Literal[
    "CLAUDE_CODE", "CODEX", "GEMINI_CLI", "PI"
]

GET_SESSIONS_ID_REUSE_RESPONSE_200_ITEMS_ITEM_READER_HARNESS_VALUES: set[
    GetSessionsIdReuseResponse200ItemsItemReaderHarness
] = {
    "CLAUDE_CODE",
    "CODEX",
    "GEMINI_CLI",
    "PI",
}


def check_get_sessions_id_reuse_response_200_items_item_reader_harness(
    value: str,
) -> GetSessionsIdReuseResponse200ItemsItemReaderHarness:
    if value in GET_SESSIONS_ID_REUSE_RESPONSE_200_ITEMS_ITEM_READER_HARNESS_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_SESSIONS_ID_REUSE_RESPONSE_200_ITEMS_ITEM_READER_HARNESS_VALUES!r}"
    )
