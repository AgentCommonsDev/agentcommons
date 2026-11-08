from typing import Literal

PutAdminToolPolicyBodyRulesItemHarnessesItem = Literal[
    "CLAUDE_CODE", "CODEX", "GEMINI_CLI", "PI"
]

PUT_ADMIN_TOOL_POLICY_BODY_RULES_ITEM_HARNESSES_ITEM_VALUES: set[
    PutAdminToolPolicyBodyRulesItemHarnessesItem
] = {
    "CLAUDE_CODE",
    "CODEX",
    "GEMINI_CLI",
    "PI",
}


def check_put_admin_tool_policy_body_rules_item_harnesses_item(
    value: str,
) -> PutAdminToolPolicyBodyRulesItemHarnessesItem:
    if value in PUT_ADMIN_TOOL_POLICY_BODY_RULES_ITEM_HARNESSES_ITEM_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {PUT_ADMIN_TOOL_POLICY_BODY_RULES_ITEM_HARNESSES_ITEM_VALUES!r}"
    )
