from typing import Literal

GetAdminRedactionRescanOrder = Literal["asc", "desc"]

GET_ADMIN_REDACTION_RESCAN_ORDER_VALUES: set[GetAdminRedactionRescanOrder] = {
    "asc",
    "desc",
}


def check_get_admin_redaction_rescan_order(value: str) -> GetAdminRedactionRescanOrder:
    if value in GET_ADMIN_REDACTION_RESCAN_ORDER_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ADMIN_REDACTION_RESCAN_ORDER_VALUES!r}"
    )
