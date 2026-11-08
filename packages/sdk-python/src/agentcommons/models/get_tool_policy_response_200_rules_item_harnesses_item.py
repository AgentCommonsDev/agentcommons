from typing import Literal

GetToolPolicyResponse200RulesItemHarnessesItem = Literal[
    "CLAUDE_CODE", "CODEX", "GEMINI_CLI", "PI"
]

GET_TOOL_POLICY_RESPONSE_200_RULES_ITEM_HARNESSES_ITEM_VALUES: set[
    GetToolPolicyResponse200RulesItemHarnessesItem
] = {
    "CLAUDE_CODE",
    "CODEX",
    "GEMINI_CLI",
    "PI",
}


def check_get_tool_policy_response_200_rules_item_harnesses_item(
    value: str,
) -> GetToolPolicyResponse200RulesItemHarnessesItem:
    if value in GET_TOOL_POLICY_RESPONSE_200_RULES_ITEM_HARNESSES_ITEM_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_TOOL_POLICY_RESPONSE_200_RULES_ITEM_HARNESSES_ITEM_VALUES!r}"
    )
