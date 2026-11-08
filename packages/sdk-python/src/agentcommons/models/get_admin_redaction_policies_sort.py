from typing import Literal

GetAdminRedactionPoliciesSort = Literal[
    "builtin", "created_at", "enabled", "kind", "name", "updated_at"
]

GET_ADMIN_REDACTION_POLICIES_SORT_VALUES: set[GetAdminRedactionPoliciesSort] = {
    "builtin",
    "created_at",
    "enabled",
    "kind",
    "name",
    "updated_at",
}


def check_get_admin_redaction_policies_sort(
    value: str,
) -> GetAdminRedactionPoliciesSort:
    if value in GET_ADMIN_REDACTION_POLICIES_SORT_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ADMIN_REDACTION_POLICIES_SORT_VALUES!r}"
    )
