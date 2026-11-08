from typing import Literal

GetAdminAuditResponse200ItemsItemTransport = Literal["mcp", "rest", "web"]

GET_ADMIN_AUDIT_RESPONSE_200_ITEMS_ITEM_TRANSPORT_VALUES: set[
    GetAdminAuditResponse200ItemsItemTransport
] = {
    "mcp",
    "rest",
    "web",
}


def check_get_admin_audit_response_200_items_item_transport(
    value: str,
) -> GetAdminAuditResponse200ItemsItemTransport:
    if value in GET_ADMIN_AUDIT_RESPONSE_200_ITEMS_ITEM_TRANSPORT_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ADMIN_AUDIT_RESPONSE_200_ITEMS_ITEM_TRANSPORT_VALUES!r}"
    )
