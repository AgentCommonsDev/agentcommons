from typing import Literal

PostMeKeysResponse200MetadataPermissionsAdminItem = Literal["*"]

POST_ME_KEYS_RESPONSE_200_METADATA_PERMISSIONS_ADMIN_ITEM_VALUES: set[
    PostMeKeysResponse200MetadataPermissionsAdminItem
] = {
    "*",
}


def check_post_me_keys_response_200_metadata_permissions_admin_item(
    value: str,
) -> PostMeKeysResponse200MetadataPermissionsAdminItem:
    if value in POST_ME_KEYS_RESPONSE_200_METADATA_PERMISSIONS_ADMIN_ITEM_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {POST_ME_KEYS_RESPONSE_200_METADATA_PERMISSIONS_ADMIN_ITEM_VALUES!r}"
    )
