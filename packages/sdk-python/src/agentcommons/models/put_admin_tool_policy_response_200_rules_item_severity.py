from typing import Literal

PutAdminToolPolicyResponse200RulesItemSeverity = Literal[
    "critical", "high", "low", "medium"
]

PUT_ADMIN_TOOL_POLICY_RESPONSE_200_RULES_ITEM_SEVERITY_VALUES: set[
    PutAdminToolPolicyResponse200RulesItemSeverity
] = {
    "critical",
    "high",
    "low",
    "medium",
}


def check_put_admin_tool_policy_response_200_rules_item_severity(
    value: str,
) -> PutAdminToolPolicyResponse200RulesItemSeverity:
    if value in PUT_ADMIN_TOOL_POLICY_RESPONSE_200_RULES_ITEM_SEVERITY_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {PUT_ADMIN_TOOL_POLICY_RESPONSE_200_RULES_ITEM_SEVERITY_VALUES!r}"
    )
