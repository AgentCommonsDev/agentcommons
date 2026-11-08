from typing import Literal

PutAdminToolPolicyResponse200RulesItemAction = Literal["allow", "deny", "warn"]

PUT_ADMIN_TOOL_POLICY_RESPONSE_200_RULES_ITEM_ACTION_VALUES: set[
    PutAdminToolPolicyResponse200RulesItemAction
] = {
    "allow",
    "deny",
    "warn",
}


def check_put_admin_tool_policy_response_200_rules_item_action(
    value: str,
) -> PutAdminToolPolicyResponse200RulesItemAction:
    if value in PUT_ADMIN_TOOL_POLICY_RESPONSE_200_RULES_ITEM_ACTION_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {PUT_ADMIN_TOOL_POLICY_RESPONSE_200_RULES_ITEM_ACTION_VALUES!r}"
    )
