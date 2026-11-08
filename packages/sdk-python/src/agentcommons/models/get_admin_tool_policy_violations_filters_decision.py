from typing import Literal

GetAdminToolPolicyViolationsFiltersDecision = Literal["allow", "deny", "warn"]

GET_ADMIN_TOOL_POLICY_VIOLATIONS_FILTERS_DECISION_VALUES: set[
    GetAdminToolPolicyViolationsFiltersDecision
] = {
    "allow",
    "deny",
    "warn",
}


def check_get_admin_tool_policy_violations_filters_decision(
    value: str,
) -> GetAdminToolPolicyViolationsFiltersDecision:
    if value in GET_ADMIN_TOOL_POLICY_VIOLATIONS_FILTERS_DECISION_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ADMIN_TOOL_POLICY_VIOLATIONS_FILTERS_DECISION_VALUES!r}"
    )
