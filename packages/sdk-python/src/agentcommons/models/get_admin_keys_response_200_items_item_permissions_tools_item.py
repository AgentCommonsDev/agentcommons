from typing import Literal

GetAdminKeysResponse200ItemsItemPermissionsToolsItem = Literal[
    "administration", "dashboards"
]

GET_ADMIN_KEYS_RESPONSE_200_ITEMS_ITEM_PERMISSIONS_TOOLS_ITEM_VALUES: set[
    GetAdminKeysResponse200ItemsItemPermissionsToolsItem
] = {
    "administration",
    "dashboards",
}


def check_get_admin_keys_response_200_items_item_permissions_tools_item(
    value: str,
) -> GetAdminKeysResponse200ItemsItemPermissionsToolsItem:
    if value in GET_ADMIN_KEYS_RESPONSE_200_ITEMS_ITEM_PERMISSIONS_TOOLS_ITEM_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ADMIN_KEYS_RESPONSE_200_ITEMS_ITEM_PERMISSIONS_TOOLS_ITEM_VALUES!r}"
    )
