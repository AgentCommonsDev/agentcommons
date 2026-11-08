from typing import Literal

GetAdminSessionsResponse200ItemsItemVisibility = Literal["PRIVATE", "PUBLIC"]

GET_ADMIN_SESSIONS_RESPONSE_200_ITEMS_ITEM_VISIBILITY_VALUES: set[
    GetAdminSessionsResponse200ItemsItemVisibility
] = {
    "PRIVATE",
    "PUBLIC",
}


def check_get_admin_sessions_response_200_items_item_visibility(
    value: str,
) -> GetAdminSessionsResponse200ItemsItemVisibility:
    if value in GET_ADMIN_SESSIONS_RESPONSE_200_ITEMS_ITEM_VISIBILITY_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ADMIN_SESSIONS_RESPONSE_200_ITEMS_ITEM_VISIBILITY_VALUES!r}"
    )
