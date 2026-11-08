from typing import Literal

GetSessionsIdResponse200MessagesItemRole = Literal[
    "ASSISTANT", "SYSTEM", "TOOL_RESULT", "USER"
]

GET_SESSIONS_ID_RESPONSE_200_MESSAGES_ITEM_ROLE_VALUES: set[
    GetSessionsIdResponse200MessagesItemRole
] = {
    "ASSISTANT",
    "SYSTEM",
    "TOOL_RESULT",
    "USER",
}


def check_get_sessions_id_response_200_messages_item_role(
    value: str,
) -> GetSessionsIdResponse200MessagesItemRole:
    if value in GET_SESSIONS_ID_RESPONSE_200_MESSAGES_ITEM_ROLE_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_SESSIONS_ID_RESPONSE_200_MESSAGES_ITEM_ROLE_VALUES!r}"
    )
