from typing import Literal

GetToolPolicyResponse200RulesItemAction = Literal["allow", "deny", "warn"]

GET_TOOL_POLICY_RESPONSE_200_RULES_ITEM_ACTION_VALUES: set[
    GetToolPolicyResponse200RulesItemAction
] = {
    "allow",
    "deny",
    "warn",
}


def check_get_tool_policy_response_200_rules_item_action(
    value: str,
) -> GetToolPolicyResponse200RulesItemAction:
    if value in GET_TOOL_POLICY_RESPONSE_200_RULES_ITEM_ACTION_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_TOOL_POLICY_RESPONSE_200_RULES_ITEM_ACTION_VALUES!r}"
    )
