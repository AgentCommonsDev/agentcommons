from typing import Literal

GetAdminAuditFormat = Literal["csv", "json"]

GET_ADMIN_AUDIT_FORMAT_VALUES: set[GetAdminAuditFormat] = {
    "csv",
    "json",
}


def check_get_admin_audit_format(value: str) -> GetAdminAuditFormat:
    if value in GET_ADMIN_AUDIT_FORMAT_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ADMIN_AUDIT_FORMAT_VALUES!r}"
    )
