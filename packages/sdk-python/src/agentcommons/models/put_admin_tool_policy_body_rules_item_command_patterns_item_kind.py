from typing import Literal

PutAdminToolPolicyBodyRulesItemCommandPatternsItemKind = Literal["regex", "substring"]

PUT_ADMIN_TOOL_POLICY_BODY_RULES_ITEM_COMMAND_PATTERNS_ITEM_KIND_VALUES: set[
    PutAdminToolPolicyBodyRulesItemCommandPatternsItemKind
] = {
    "regex",
    "substring",
}


def check_put_admin_tool_policy_body_rules_item_command_patterns_item_kind(
    value: str,
) -> PutAdminToolPolicyBodyRulesItemCommandPatternsItemKind:
    if value in PUT_ADMIN_TOOL_POLICY_BODY_RULES_ITEM_COMMAND_PATTERNS_ITEM_KIND_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {PUT_ADMIN_TOOL_POLICY_BODY_RULES_ITEM_COMMAND_PATTERNS_ITEM_KIND_VALUES!r}"
    )
