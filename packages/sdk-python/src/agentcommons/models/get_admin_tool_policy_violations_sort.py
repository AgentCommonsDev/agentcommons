from typing import Literal

GetAdminToolPolicyViolationsSort = Literal["matched_at", "seq"]

GET_ADMIN_TOOL_POLICY_VIOLATIONS_SORT_VALUES: set[GetAdminToolPolicyViolationsSort] = {
    "matched_at",
    "seq",
}


def check_get_admin_tool_policy_violations_sort(
    value: str,
) -> GetAdminToolPolicyViolationsSort:
    if value in GET_ADMIN_TOOL_POLICY_VIOLATIONS_SORT_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ADMIN_TOOL_POLICY_VIOLATIONS_SORT_VALUES!r}"
    )
