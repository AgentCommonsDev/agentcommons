from typing import Literal

GetAdminAuditFiltersTransport = Literal["mcp", "rest", "web"]

GET_ADMIN_AUDIT_FILTERS_TRANSPORT_VALUES: set[GetAdminAuditFiltersTransport] = {
    "mcp",
    "rest",
    "web",
}


def check_get_admin_audit_filters_transport(
    value: str,
) -> GetAdminAuditFiltersTransport:
    if value in GET_ADMIN_AUDIT_FILTERS_TRANSPORT_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ADMIN_AUDIT_FILTERS_TRANSPORT_VALUES!r}"
    )
