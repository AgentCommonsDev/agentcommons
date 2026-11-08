from typing import Literal

GetMeKeysResponse200ItemsItemPermissionsSessionsItem = Literal["ingest", "read"]

GET_ME_KEYS_RESPONSE_200_ITEMS_ITEM_PERMISSIONS_SESSIONS_ITEM_VALUES: set[
    GetMeKeysResponse200ItemsItemPermissionsSessionsItem
] = {
    "ingest",
    "read",
}


def check_get_me_keys_response_200_items_item_permissions_sessions_item(
    value: str,
) -> GetMeKeysResponse200ItemsItemPermissionsSessionsItem:
    if value in GET_ME_KEYS_RESPONSE_200_ITEMS_ITEM_PERMISSIONS_SESSIONS_ITEM_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ME_KEYS_RESPONSE_200_ITEMS_ITEM_PERMISSIONS_SESSIONS_ITEM_VALUES!r}"
    )
