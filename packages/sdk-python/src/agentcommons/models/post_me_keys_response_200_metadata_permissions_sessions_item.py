from typing import Literal

PostMeKeysResponse200MetadataPermissionsSessionsItem = Literal["ingest", "read"]

POST_ME_KEYS_RESPONSE_200_METADATA_PERMISSIONS_SESSIONS_ITEM_VALUES: set[
    PostMeKeysResponse200MetadataPermissionsSessionsItem
] = {
    "ingest",
    "read",
}


def check_post_me_keys_response_200_metadata_permissions_sessions_item(
    value: str,
) -> PostMeKeysResponse200MetadataPermissionsSessionsItem:
    if value in POST_ME_KEYS_RESPONSE_200_METADATA_PERMISSIONS_SESSIONS_ITEM_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {POST_ME_KEYS_RESPONSE_200_METADATA_PERMISSIONS_SESSIONS_ITEM_VALUES!r}"
    )
