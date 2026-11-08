from typing import Literal

PutAdminToolPolicyResponse200RulesItemCommandPatternsItemKind = Literal[
    "regex", "substring"
]

PUT_ADMIN_TOOL_POLICY_RESPONSE_200_RULES_ITEM_COMMAND_PATTERNS_ITEM_KIND_VALUES: set[
    PutAdminToolPolicyResponse200RulesItemCommandPatternsItemKind
] = {
    "regex",
    "substring",
}


def check_put_admin_tool_policy_response_200_rules_item_command_patterns_item_kind(
    value: str,
) -> PutAdminToolPolicyResponse200RulesItemCommandPatternsItemKind:
    if (
        value
        in PUT_ADMIN_TOOL_POLICY_RESPONSE_200_RULES_ITEM_COMMAND_PATTERNS_ITEM_KIND_VALUES
    ):
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {PUT_ADMIN_TOOL_POLICY_RESPONSE_200_RULES_ITEM_COMMAND_PATTERNS_ITEM_KIND_VALUES!r}"
    )
