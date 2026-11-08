from typing import Literal

GetAdminKeysResponse200ItemsItemPermissionsAdminItem = Literal["*"]

GET_ADMIN_KEYS_RESPONSE_200_ITEMS_ITEM_PERMISSIONS_ADMIN_ITEM_VALUES: set[
    GetAdminKeysResponse200ItemsItemPermissionsAdminItem
] = {
    "*",
}


def check_get_admin_keys_response_200_items_item_permissions_admin_item(
    value: str,
) -> GetAdminKeysResponse200ItemsItemPermissionsAdminItem:
    if value in GET_ADMIN_KEYS_RESPONSE_200_ITEMS_ITEM_PERMISSIONS_ADMIN_ITEM_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ADMIN_KEYS_RESPONSE_200_ITEMS_ITEM_PERMISSIONS_ADMIN_ITEM_VALUES!r}"
    )
