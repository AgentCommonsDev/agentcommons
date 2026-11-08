from typing import Literal

GetAdminToolPolicyResponse200RulesItemAction = Literal["allow", "deny", "warn"]

GET_ADMIN_TOOL_POLICY_RESPONSE_200_RULES_ITEM_ACTION_VALUES: set[
    GetAdminToolPolicyResponse200RulesItemAction
] = {
    "allow",
    "deny",
    "warn",
}


def check_get_admin_tool_policy_response_200_rules_item_action(
    value: str,
) -> GetAdminToolPolicyResponse200RulesItemAction:
    if value in GET_ADMIN_TOOL_POLICY_RESPONSE_200_RULES_ITEM_ACTION_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ADMIN_TOOL_POLICY_RESPONSE_200_RULES_ITEM_ACTION_VALUES!r}"
    )
