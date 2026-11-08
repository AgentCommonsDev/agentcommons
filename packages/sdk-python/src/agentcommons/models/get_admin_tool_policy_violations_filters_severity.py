from typing import Literal

GetAdminToolPolicyViolationsFiltersSeverity = Literal[
    "critical", "high", "low", "medium"
]

GET_ADMIN_TOOL_POLICY_VIOLATIONS_FILTERS_SEVERITY_VALUES: set[
    GetAdminToolPolicyViolationsFiltersSeverity
] = {
    "critical",
    "high",
    "low",
    "medium",
}


def check_get_admin_tool_policy_violations_filters_severity(
    value: str,
) -> GetAdminToolPolicyViolationsFiltersSeverity:
    if value in GET_ADMIN_TOOL_POLICY_VIOLATIONS_FILTERS_SEVERITY_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ADMIN_TOOL_POLICY_VIOLATIONS_FILTERS_SEVERITY_VALUES!r}"
    )
