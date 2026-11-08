from typing import Literal

GetSessionsResponse200ItemsItemStatus = Literal["ACTIVE", "ENDED", "INACTIVE"]

GET_SESSIONS_RESPONSE_200_ITEMS_ITEM_STATUS_VALUES: set[
    GetSessionsResponse200ItemsItemStatus
] = {
    "ACTIVE",
    "ENDED",
    "INACTIVE",
}


def check_get_sessions_response_200_items_item_status(
    value: str,
) -> GetSessionsResponse200ItemsItemStatus:
    if value in GET_SESSIONS_RESPONSE_200_ITEMS_ITEM_STATUS_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_SESSIONS_RESPONSE_200_ITEMS_ITEM_STATUS_VALUES!r}"
    )
