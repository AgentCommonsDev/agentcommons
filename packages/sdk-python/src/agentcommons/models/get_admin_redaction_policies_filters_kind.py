from typing import Literal

GetAdminRedactionPoliciesFiltersKind = Literal["REGEX", "SECRETLINT_RULE"]

GET_ADMIN_REDACTION_POLICIES_FILTERS_KIND_VALUES: set[
    GetAdminRedactionPoliciesFiltersKind
] = {
    "REGEX",
    "SECRETLINT_RULE",
}


def check_get_admin_redaction_policies_filters_kind(
    value: str,
) -> GetAdminRedactionPoliciesFiltersKind:
    if value in GET_ADMIN_REDACTION_POLICIES_FILTERS_KIND_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ADMIN_REDACTION_POLICIES_FILTERS_KIND_VALUES!r}"
    )
