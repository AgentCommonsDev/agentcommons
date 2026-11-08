from typing import Literal

GetAdminToolPolicyResponse200RulesItemSeverity = Literal[
    "critical", "high", "low", "medium"
]

GET_ADMIN_TOOL_POLICY_RESPONSE_200_RULES_ITEM_SEVERITY_VALUES: set[
    GetAdminToolPolicyResponse200RulesItemSeverity
] = {
    "critical",
    "high",
    "low",
    "medium",
}


def check_get_admin_tool_policy_response_200_rules_item_severity(
    value: str,
) -> GetAdminToolPolicyResponse200RulesItemSeverity:
    if value in GET_ADMIN_TOOL_POLICY_RESPONSE_200_RULES_ITEM_SEVERITY_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ADMIN_TOOL_POLICY_RESPONSE_200_RULES_ITEM_SEVERITY_VALUES!r}"
    )
