from typing import Literal

PostMeKeysResponse200MetadataPermissionsToolsItem = Literal[
    "administration", "dashboards"
]

POST_ME_KEYS_RESPONSE_200_METADATA_PERMISSIONS_TOOLS_ITEM_VALUES: set[
    PostMeKeysResponse200MetadataPermissionsToolsItem
] = {
    "administration",
    "dashboards",
}


def check_post_me_keys_response_200_metadata_permissions_tools_item(
    value: str,
) -> PostMeKeysResponse200MetadataPermissionsToolsItem:
    if value in POST_ME_KEYS_RESPONSE_200_METADATA_PERMISSIONS_TOOLS_ITEM_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {POST_ME_KEYS_RESPONSE_200_METADATA_PERMISSIONS_TOOLS_ITEM_VALUES!r}"
    )
