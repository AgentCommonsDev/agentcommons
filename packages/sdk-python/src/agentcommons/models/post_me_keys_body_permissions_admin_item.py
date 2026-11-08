from typing import Literal

PostMeKeysBodyPermissionsAdminItem = Literal["*"]

POST_ME_KEYS_BODY_PERMISSIONS_ADMIN_ITEM_VALUES: set[
    PostMeKeysBodyPermissionsAdminItem
] = {
    "*",
}


def check_post_me_keys_body_permissions_admin_item(
    value: str,
) -> PostMeKeysBodyPermissionsAdminItem:
    if value in POST_ME_KEYS_BODY_PERMISSIONS_ADMIN_ITEM_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {POST_ME_KEYS_BODY_PERMISSIONS_ADMIN_ITEM_VALUES!r}"
    )
