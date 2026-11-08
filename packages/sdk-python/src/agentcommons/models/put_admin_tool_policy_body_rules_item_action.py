from typing import Literal

PutAdminToolPolicyBodyRulesItemAction = Literal["allow", "deny", "warn"]

PUT_ADMIN_TOOL_POLICY_BODY_RULES_ITEM_ACTION_VALUES: set[
    PutAdminToolPolicyBodyRulesItemAction
] = {
    "allow",
    "deny",
    "warn",
}


def check_put_admin_tool_policy_body_rules_item_action(
    value: str,
) -> PutAdminToolPolicyBodyRulesItemAction:
    if value in PUT_ADMIN_TOOL_POLICY_BODY_RULES_ITEM_ACTION_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {PUT_ADMIN_TOOL_POLICY_BODY_RULES_ITEM_ACTION_VALUES!r}"
    )
