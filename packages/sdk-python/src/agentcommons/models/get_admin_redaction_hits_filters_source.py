from typing import Literal

GetAdminRedactionHitsFiltersSource = Literal["capture", "rescan"]

GET_ADMIN_REDACTION_HITS_FILTERS_SOURCE_VALUES: set[
    GetAdminRedactionHitsFiltersSource
] = {
    "capture",
    "rescan",
}


def check_get_admin_redaction_hits_filters_source(
    value: str,
) -> GetAdminRedactionHitsFiltersSource:
    if value in GET_ADMIN_REDACTION_HITS_FILTERS_SOURCE_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ADMIN_REDACTION_HITS_FILTERS_SOURCE_VALUES!r}"
    )
