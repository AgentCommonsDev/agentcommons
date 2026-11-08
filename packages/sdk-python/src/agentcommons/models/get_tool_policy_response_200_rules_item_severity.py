from typing import Literal

GetToolPolicyResponse200RulesItemSeverity = Literal["critical", "high", "low", "medium"]

GET_TOOL_POLICY_RESPONSE_200_RULES_ITEM_SEVERITY_VALUES: set[
    GetToolPolicyResponse200RulesItemSeverity
] = {
    "critical",
    "high",
    "low",
    "medium",
}


def check_get_tool_policy_response_200_rules_item_severity(
    value: str,
) -> GetToolPolicyResponse200RulesItemSeverity:
    if value in GET_TOOL_POLICY_RESPONSE_200_RULES_ITEM_SEVERITY_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_TOOL_POLICY_RESPONSE_200_RULES_ITEM_SEVERITY_VALUES!r}"
    )
