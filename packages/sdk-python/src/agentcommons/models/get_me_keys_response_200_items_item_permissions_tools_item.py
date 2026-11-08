from typing import Literal

GetMeKeysResponse200ItemsItemPermissionsToolsItem = Literal[
    "administration", "dashboards"
]

GET_ME_KEYS_RESPONSE_200_ITEMS_ITEM_PERMISSIONS_TOOLS_ITEM_VALUES: set[
    GetMeKeysResponse200ItemsItemPermissionsToolsItem
] = {
    "administration",
    "dashboards",
}


def check_get_me_keys_response_200_items_item_permissions_tools_item(
    value: str,
) -> GetMeKeysResponse200ItemsItemPermissionsToolsItem:
    if value in GET_ME_KEYS_RESPONSE_200_ITEMS_ITEM_PERMISSIONS_TOOLS_ITEM_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ME_KEYS_RESPONSE_200_ITEMS_ITEM_PERMISSIONS_TOOLS_ITEM_VALUES!r}"
    )
