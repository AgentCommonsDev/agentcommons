from typing import Literal

GetAdminAuditOrder = Literal["asc", "desc"]

GET_ADMIN_AUDIT_ORDER_VALUES: set[GetAdminAuditOrder] = {
    "asc",
    "desc",
}


def check_get_admin_audit_order(value: str) -> GetAdminAuditOrder:
    if value in GET_ADMIN_AUDIT_ORDER_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ADMIN_AUDIT_ORDER_VALUES!r}"
    )
