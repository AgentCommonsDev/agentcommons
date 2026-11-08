from typing import Literal

GetAdminRedactionRescanIdSessionsOrder = Literal["asc", "desc"]

GET_ADMIN_REDACTION_RESCAN_ID_SESSIONS_ORDER_VALUES: set[
    GetAdminRedactionRescanIdSessionsOrder
] = {
    "asc",
    "desc",
}


def check_get_admin_redaction_rescan_id_sessions_order(
    value: str,
) -> GetAdminRedactionRescanIdSessionsOrder:
    if value in GET_ADMIN_REDACTION_RESCAN_ID_SESSIONS_ORDER_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ADMIN_REDACTION_RESCAN_ID_SESSIONS_ORDER_VALUES!r}"
    )
