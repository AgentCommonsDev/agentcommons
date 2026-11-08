from typing import Literal

GetAdminToolPolicyViolationsFiltersHarness = Literal[
    "CLAUDE_CODE", "CODEX", "GEMINI_CLI", "PI"
]

GET_ADMIN_TOOL_POLICY_VIOLATIONS_FILTERS_HARNESS_VALUES: set[
    GetAdminToolPolicyViolationsFiltersHarness
] = {
    "CLAUDE_CODE",
    "CODEX",
    "GEMINI_CLI",
    "PI",
}


def check_get_admin_tool_policy_violations_filters_harness(
    value: str,
) -> GetAdminToolPolicyViolationsFiltersHarness:
    if value in GET_ADMIN_TOOL_POLICY_VIOLATIONS_FILTERS_HARNESS_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ADMIN_TOOL_POLICY_VIOLATIONS_FILTERS_HARNESS_VALUES!r}"
    )
