from typing import Literal

GetAdminToolPolicyResponse200RulesItemHarnessesItem = Literal[
    "CLAUDE_CODE", "CODEX", "GEMINI_CLI", "PI"
]

GET_ADMIN_TOOL_POLICY_RESPONSE_200_RULES_ITEM_HARNESSES_ITEM_VALUES: set[
    GetAdminToolPolicyResponse200RulesItemHarnessesItem
] = {
    "CLAUDE_CODE",
    "CODEX",
    "GEMINI_CLI",
    "PI",
}


def check_get_admin_tool_policy_response_200_rules_item_harnesses_item(
    value: str,
) -> GetAdminToolPolicyResponse200RulesItemHarnessesItem:
    if value in GET_ADMIN_TOOL_POLICY_RESPONSE_200_RULES_ITEM_HARNESSES_ITEM_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ADMIN_TOOL_POLICY_RESPONSE_200_RULES_ITEM_HARNESSES_ITEM_VALUES!r}"
    )
