from typing import Literal

GetAdminRedactionRescanIdSessionsFormat = Literal["csv", "json"]

GET_ADMIN_REDACTION_RESCAN_ID_SESSIONS_FORMAT_VALUES: set[
    GetAdminRedactionRescanIdSessionsFormat
] = {
    "csv",
    "json",
}


def check_get_admin_redaction_rescan_id_sessions_format(
    value: str,
) -> GetAdminRedactionRescanIdSessionsFormat:
    if value in GET_ADMIN_REDACTION_RESCAN_ID_SESSIONS_FORMAT_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ADMIN_REDACTION_RESCAN_ID_SESSIONS_FORMAT_VALUES!r}"
    )
