from typing import Literal

PostMeKeysBodyPermissionsSessionsItem = Literal["ingest", "read"]

POST_ME_KEYS_BODY_PERMISSIONS_SESSIONS_ITEM_VALUES: set[
    PostMeKeysBodyPermissionsSessionsItem
] = {
    "ingest",
    "read",
}


def check_post_me_keys_body_permissions_sessions_item(
    value: str,
) -> PostMeKeysBodyPermissionsSessionsItem:
    if value in POST_ME_KEYS_BODY_PERMISSIONS_SESSIONS_ITEM_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {POST_ME_KEYS_BODY_PERMISSIONS_SESSIONS_ITEM_VALUES!r}"
    )
