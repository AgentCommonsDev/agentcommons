from typing import Literal

PostMeKeysBodyPermissionsToolsItem = Literal["administration", "dashboards"]

POST_ME_KEYS_BODY_PERMISSIONS_TOOLS_ITEM_VALUES: set[
    PostMeKeysBodyPermissionsToolsItem
] = {
    "administration",
    "dashboards",
}


def check_post_me_keys_body_permissions_tools_item(
    value: str,
) -> PostMeKeysBodyPermissionsToolsItem:
    if value in POST_ME_KEYS_BODY_PERMISSIONS_TOOLS_ITEM_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {POST_ME_KEYS_BODY_PERMISSIONS_TOOLS_ITEM_VALUES!r}"
    )
