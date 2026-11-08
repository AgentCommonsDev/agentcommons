from typing import Literal

GetAdminToolPolicyResponse200RulesItemCommandPatternsItemKind = Literal[
    "regex", "substring"
]

GET_ADMIN_TOOL_POLICY_RESPONSE_200_RULES_ITEM_COMMAND_PATTERNS_ITEM_KIND_VALUES: set[
    GetAdminToolPolicyResponse200RulesItemCommandPatternsItemKind
] = {
    "regex",
    "substring",
}


def check_get_admin_tool_policy_response_200_rules_item_command_patterns_item_kind(
    value: str,
) -> GetAdminToolPolicyResponse200RulesItemCommandPatternsItemKind:
    if (
        value
        in GET_ADMIN_TOOL_POLICY_RESPONSE_200_RULES_ITEM_COMMAND_PATTERNS_ITEM_KIND_VALUES
    ):
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ADMIN_TOOL_POLICY_RESPONSE_200_RULES_ITEM_COMMAND_PATTERNS_ITEM_KIND_VALUES!r}"
    )
