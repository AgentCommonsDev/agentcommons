from typing import Literal

PutAdminToolPolicyResponse200RulesItemHarnessesItem = Literal[
    "CLAUDE_CODE", "CODEX", "GEMINI_CLI", "PI"
]

PUT_ADMIN_TOOL_POLICY_RESPONSE_200_RULES_ITEM_HARNESSES_ITEM_VALUES: set[
    PutAdminToolPolicyResponse200RulesItemHarnessesItem
] = {
    "CLAUDE_CODE",
    "CODEX",
    "GEMINI_CLI",
    "PI",
}


def check_put_admin_tool_policy_response_200_rules_item_harnesses_item(
    value: str,
) -> PutAdminToolPolicyResponse200RulesItemHarnessesItem:
    if value in PUT_ADMIN_TOOL_POLICY_RESPONSE_200_RULES_ITEM_HARNESSES_ITEM_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {PUT_ADMIN_TOOL_POLICY_RESPONSE_200_RULES_ITEM_HARNESSES_ITEM_VALUES!r}"
    )
