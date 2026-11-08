from typing import Literal

GetAdminRedactionHitsOrder = Literal["asc", "desc"]

GET_ADMIN_REDACTION_HITS_ORDER_VALUES: set[GetAdminRedactionHitsOrder] = {
    "asc",
    "desc",
}


def check_get_admin_redaction_hits_order(value: str) -> GetAdminRedactionHitsOrder:
    if value in GET_ADMIN_REDACTION_HITS_ORDER_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ADMIN_REDACTION_HITS_ORDER_VALUES!r}"
    )
