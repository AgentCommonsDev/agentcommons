from typing import Literal

GetAdminSessionsResponse200ItemsItemStatus = Literal["ACTIVE", "ENDED", "INACTIVE"]

GET_ADMIN_SESSIONS_RESPONSE_200_ITEMS_ITEM_STATUS_VALUES: set[
    GetAdminSessionsResponse200ItemsItemStatus
] = {
    "ACTIVE",
    "ENDED",
    "INACTIVE",
}


def check_get_admin_sessions_response_200_items_item_status(
    value: str,
) -> GetAdminSessionsResponse200ItemsItemStatus:
    if value in GET_ADMIN_SESSIONS_RESPONSE_200_ITEMS_ITEM_STATUS_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ADMIN_SESSIONS_RESPONSE_200_ITEMS_ITEM_STATUS_VALUES!r}"
    )
