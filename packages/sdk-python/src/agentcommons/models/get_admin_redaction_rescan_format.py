from typing import Literal

GetAdminRedactionRescanFormat = Literal["csv", "json"]

GET_ADMIN_REDACTION_RESCAN_FORMAT_VALUES: set[GetAdminRedactionRescanFormat] = {
    "csv",
    "json",
}


def check_get_admin_redaction_rescan_format(
    value: str,
) -> GetAdminRedactionRescanFormat:
    if value in GET_ADMIN_REDACTION_RESCAN_FORMAT_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ADMIN_REDACTION_RESCAN_FORMAT_VALUES!r}"
    )
