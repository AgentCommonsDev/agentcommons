from typing import Literal

GetAdminRedactionRescanResponse200ItemsItemState = Literal[
    "completed", "failed", "queued", "running"
]

GET_ADMIN_REDACTION_RESCAN_RESPONSE_200_ITEMS_ITEM_STATE_VALUES: set[
    GetAdminRedactionRescanResponse200ItemsItemState
] = {
    "completed",
    "failed",
    "queued",
    "running",
}


def check_get_admin_redaction_rescan_response_200_items_item_state(
    value: str,
) -> GetAdminRedactionRescanResponse200ItemsItemState:
    if value in GET_ADMIN_REDACTION_RESCAN_RESPONSE_200_ITEMS_ITEM_STATE_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ADMIN_REDACTION_RESCAN_RESPONSE_200_ITEMS_ITEM_STATE_VALUES!r}"
    )
