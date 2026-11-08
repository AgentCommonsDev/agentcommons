from typing import Literal

GetSessionsResponse200ItemsItemVisibility = Literal["PRIVATE", "PUBLIC"]

GET_SESSIONS_RESPONSE_200_ITEMS_ITEM_VISIBILITY_VALUES: set[
    GetSessionsResponse200ItemsItemVisibility
] = {
    "PRIVATE",
    "PUBLIC",
}


def check_get_sessions_response_200_items_item_visibility(
    value: str,
) -> GetSessionsResponse200ItemsItemVisibility:
    if value in GET_SESSIONS_RESPONSE_200_ITEMS_ITEM_VISIBILITY_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_SESSIONS_RESPONSE_200_ITEMS_ITEM_VISIBILITY_VALUES!r}"
    )
