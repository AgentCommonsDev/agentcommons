from typing import Literal

GetAdminSessionsResponse200ItemsItemHarness = Literal[
    "CLAUDE_CODE", "CODEX", "GEMINI_CLI", "PI"
]

GET_ADMIN_SESSIONS_RESPONSE_200_ITEMS_ITEM_HARNESS_VALUES: set[
    GetAdminSessionsResponse200ItemsItemHarness
] = {
    "CLAUDE_CODE",
    "CODEX",
    "GEMINI_CLI",
    "PI",
}


def check_get_admin_sessions_response_200_items_item_harness(
    value: str,
) -> GetAdminSessionsResponse200ItemsItemHarness:
    if value in GET_ADMIN_SESSIONS_RESPONSE_200_ITEMS_ITEM_HARNESS_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ADMIN_SESSIONS_RESPONSE_200_ITEMS_ITEM_HARNESS_VALUES!r}"
    )
