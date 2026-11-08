from typing import Literal

GetSessionsIdSimilarResponse200SessionsItemHarness = Literal[
    "CLAUDE_CODE", "CODEX", "GEMINI_CLI", "PI"
]

GET_SESSIONS_ID_SIMILAR_RESPONSE_200_SESSIONS_ITEM_HARNESS_VALUES: set[
    GetSessionsIdSimilarResponse200SessionsItemHarness
] = {
    "CLAUDE_CODE",
    "CODEX",
    "GEMINI_CLI",
    "PI",
}


def check_get_sessions_id_similar_response_200_sessions_item_harness(
    value: str,
) -> GetSessionsIdSimilarResponse200SessionsItemHarness:
    if value in GET_SESSIONS_ID_SIMILAR_RESPONSE_200_SESSIONS_ITEM_HARNESS_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_SESSIONS_ID_SIMILAR_RESPONSE_200_SESSIONS_ITEM_HARNESS_VALUES!r}"
    )
