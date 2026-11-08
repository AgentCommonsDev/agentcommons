from typing import Literal

GetAdminRedactionHitsResponse200ItemsItemSource = Literal["capture", "rescan"]

GET_ADMIN_REDACTION_HITS_RESPONSE_200_ITEMS_ITEM_SOURCE_VALUES: set[
    GetAdminRedactionHitsResponse200ItemsItemSource
] = {
    "capture",
    "rescan",
}


def check_get_admin_redaction_hits_response_200_items_item_source(
    value: str,
) -> GetAdminRedactionHitsResponse200ItemsItemSource:
    if value in GET_ADMIN_REDACTION_HITS_RESPONSE_200_ITEMS_ITEM_SOURCE_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ADMIN_REDACTION_HITS_RESPONSE_200_ITEMS_ITEM_SOURCE_VALUES!r}"
    )
