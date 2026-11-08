from typing import Literal

GetAdminRedactionPoliciesFormat = Literal["csv", "json"]

GET_ADMIN_REDACTION_POLICIES_FORMAT_VALUES: set[GetAdminRedactionPoliciesFormat] = {
    "csv",
    "json",
}


def check_get_admin_redaction_policies_format(
    value: str,
) -> GetAdminRedactionPoliciesFormat:
    if value in GET_ADMIN_REDACTION_POLICIES_FORMAT_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ADMIN_REDACTION_POLICIES_FORMAT_VALUES!r}"
    )
