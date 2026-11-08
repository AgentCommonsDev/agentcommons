from typing import Literal

GetMeKeysResponse200ItemsItemPermissionsAdminItem = Literal["*"]

GET_ME_KEYS_RESPONSE_200_ITEMS_ITEM_PERMISSIONS_ADMIN_ITEM_VALUES: set[
    GetMeKeysResponse200ItemsItemPermissionsAdminItem
] = {
    "*",
}


def check_get_me_keys_response_200_items_item_permissions_admin_item(
    value: str,
) -> GetMeKeysResponse200ItemsItemPermissionsAdminItem:
    if value in GET_ME_KEYS_RESPONSE_200_ITEMS_ITEM_PERMISSIONS_ADMIN_ITEM_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ME_KEYS_RESPONSE_200_ITEMS_ITEM_PERMISSIONS_ADMIN_ITEM_VALUES!r}"
    )
