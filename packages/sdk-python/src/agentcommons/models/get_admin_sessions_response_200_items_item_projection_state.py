from typing import Literal

GetAdminSessionsResponse200ItemsItemProjectionState = Literal[
    "failed", "published", "queued", "waiting_source"
]

GET_ADMIN_SESSIONS_RESPONSE_200_ITEMS_ITEM_PROJECTION_STATE_VALUES: set[
    GetAdminSessionsResponse200ItemsItemProjectionState
] = {
    "failed",
    "published",
    "queued",
    "waiting_source",
}


def check_get_admin_sessions_response_200_items_item_projection_state(
    value: str,
) -> GetAdminSessionsResponse200ItemsItemProjectionState:
    if value in GET_ADMIN_SESSIONS_RESPONSE_200_ITEMS_ITEM_PROJECTION_STATE_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ADMIN_SESSIONS_RESPONSE_200_ITEMS_ITEM_PROJECTION_STATE_VALUES!r}"
    )
