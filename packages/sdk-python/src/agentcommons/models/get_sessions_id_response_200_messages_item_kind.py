from typing import Literal

GetSessionsIdResponse200MessagesItemKind = Literal[
    "META", "TEXT", "THINKING", "TOOL_RESULT", "TOOL_USE"
]

GET_SESSIONS_ID_RESPONSE_200_MESSAGES_ITEM_KIND_VALUES: set[
    GetSessionsIdResponse200MessagesItemKind
] = {
    "META",
    "TEXT",
    "THINKING",
    "TOOL_RESULT",
    "TOOL_USE",
}


def check_get_sessions_id_response_200_messages_item_kind(
    value: str,
) -> GetSessionsIdResponse200MessagesItemKind:
    if value in GET_SESSIONS_ID_RESPONSE_200_MESSAGES_ITEM_KIND_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_SESSIONS_ID_RESPONSE_200_MESSAGES_ITEM_KIND_VALUES!r}"
    )
