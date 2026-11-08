from typing import Literal

GetSessionsIdKindsItem = Literal["META", "TEXT", "THINKING", "TOOL_RESULT", "TOOL_USE"]

GET_SESSIONS_ID_KINDS_ITEM_VALUES: set[GetSessionsIdKindsItem] = {
    "META",
    "TEXT",
    "THINKING",
    "TOOL_RESULT",
    "TOOL_USE",
}


def check_get_sessions_id_kinds_item(value: str) -> GetSessionsIdKindsItem:
    if value in GET_SESSIONS_ID_KINDS_ITEM_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_SESSIONS_ID_KINDS_ITEM_VALUES!r}"
    )
