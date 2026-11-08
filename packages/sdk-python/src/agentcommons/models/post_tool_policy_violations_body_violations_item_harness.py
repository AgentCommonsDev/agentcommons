from typing import Literal

PostToolPolicyViolationsBodyViolationsItemHarness = Literal[
    "CLAUDE_CODE", "CODEX", "GEMINI_CLI", "PI"
]

POST_TOOL_POLICY_VIOLATIONS_BODY_VIOLATIONS_ITEM_HARNESS_VALUES: set[
    PostToolPolicyViolationsBodyViolationsItemHarness
] = {
    "CLAUDE_CODE",
    "CODEX",
    "GEMINI_CLI",
    "PI",
}


def check_post_tool_policy_violations_body_violations_item_harness(
    value: str,
) -> PostToolPolicyViolationsBodyViolationsItemHarness:
    if value in POST_TOOL_POLICY_VIOLATIONS_BODY_VIOLATIONS_ITEM_HARNESS_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {POST_TOOL_POLICY_VIOLATIONS_BODY_VIOLATIONS_ITEM_HARNESS_VALUES!r}"
    )
