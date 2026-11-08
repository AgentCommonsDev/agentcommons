from typing import Literal

GetAdminKeysResponse200ItemsItemPermissionsSessionsItem = Literal["ingest", "read"]

GET_ADMIN_KEYS_RESPONSE_200_ITEMS_ITEM_PERMISSIONS_SESSIONS_ITEM_VALUES: set[
    GetAdminKeysResponse200ItemsItemPermissionsSessionsItem
] = {
    "ingest",
    "read",
}


def check_get_admin_keys_response_200_items_item_permissions_sessions_item(
    value: str,
) -> GetAdminKeysResponse200ItemsItemPermissionsSessionsItem:
    if value in GET_ADMIN_KEYS_RESPONSE_200_ITEMS_ITEM_PERMISSIONS_SESSIONS_ITEM_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ADMIN_KEYS_RESPONSE_200_ITEMS_ITEM_PERMISSIONS_SESSIONS_ITEM_VALUES!r}"
    )
