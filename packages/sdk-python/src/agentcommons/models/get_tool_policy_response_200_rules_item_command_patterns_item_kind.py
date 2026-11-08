from typing import Literal

GetToolPolicyResponse200RulesItemCommandPatternsItemKind = Literal["regex", "substring"]

GET_TOOL_POLICY_RESPONSE_200_RULES_ITEM_COMMAND_PATTERNS_ITEM_KIND_VALUES: set[
    GetToolPolicyResponse200RulesItemCommandPatternsItemKind
] = {
    "regex",
    "substring",
}


def check_get_tool_policy_response_200_rules_item_command_patterns_item_kind(
    value: str,
) -> GetToolPolicyResponse200RulesItemCommandPatternsItemKind:
    if (
        value
        in GET_TOOL_POLICY_RESPONSE_200_RULES_ITEM_COMMAND_PATTERNS_ITEM_KIND_VALUES
    ):
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_TOOL_POLICY_RESPONSE_200_RULES_ITEM_COMMAND_PATTERNS_ITEM_KIND_VALUES!r}"
    )
