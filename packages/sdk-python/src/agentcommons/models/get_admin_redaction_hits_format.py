from typing import Literal

GetAdminRedactionHitsFormat = Literal["csv", "json"]

GET_ADMIN_REDACTION_HITS_FORMAT_VALUES: set[GetAdminRedactionHitsFormat] = {
    "csv",
    "json",
}


def check_get_admin_redaction_hits_format(value: str) -> GetAdminRedactionHitsFormat:
    if value in GET_ADMIN_REDACTION_HITS_FORMAT_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ADMIN_REDACTION_HITS_FORMAT_VALUES!r}"
    )
