from typing import Literal

PutAdminToolPolicyBodyRulesItemSeverity = Literal["critical", "high", "low", "medium"]

PUT_ADMIN_TOOL_POLICY_BODY_RULES_ITEM_SEVERITY_VALUES: set[
    PutAdminToolPolicyBodyRulesItemSeverity
] = {
    "critical",
    "high",
    "low",
    "medium",
}


def check_put_admin_tool_policy_body_rules_item_severity(
    value: str,
) -> PutAdminToolPolicyBodyRulesItemSeverity:
    if value in PUT_ADMIN_TOOL_POLICY_BODY_RULES_ITEM_SEVERITY_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {PUT_ADMIN_TOOL_POLICY_BODY_RULES_ITEM_SEVERITY_VALUES!r}"
    )
