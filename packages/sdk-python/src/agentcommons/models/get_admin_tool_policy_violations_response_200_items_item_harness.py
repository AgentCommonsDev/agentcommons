from typing import Literal

GetAdminToolPolicyViolationsResponse200ItemsItemHarness = Literal[
    "CLAUDE_CODE", "CODEX", "GEMINI_CLI", "PI"
]

GET_ADMIN_TOOL_POLICY_VIOLATIONS_RESPONSE_200_ITEMS_ITEM_HARNESS_VALUES: set[
    GetAdminToolPolicyViolationsResponse200ItemsItemHarness
] = {
    "CLAUDE_CODE",
    "CODEX",
    "GEMINI_CLI",
    "PI",
}


def check_get_admin_tool_policy_violations_response_200_items_item_harness(
    value: str,
) -> GetAdminToolPolicyViolationsResponse200ItemsItemHarness:
    if value in GET_ADMIN_TOOL_POLICY_VIOLATIONS_RESPONSE_200_ITEMS_ITEM_HARNESS_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ADMIN_TOOL_POLICY_VIOLATIONS_RESPONSE_200_ITEMS_ITEM_HARNESS_VALUES!r}"
    )
