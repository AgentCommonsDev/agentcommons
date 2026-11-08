from typing import Literal

PostToolPolicyViolationsBodyViolationsItemSeverity = Literal[
    "critical", "high", "low", "medium"
]

POST_TOOL_POLICY_VIOLATIONS_BODY_VIOLATIONS_ITEM_SEVERITY_VALUES: set[
    PostToolPolicyViolationsBodyViolationsItemSeverity
] = {
    "critical",
    "high",
    "low",
    "medium",
}


def check_post_tool_policy_violations_body_violations_item_severity(
    value: str,
) -> PostToolPolicyViolationsBodyViolationsItemSeverity:
    if value in POST_TOOL_POLICY_VIOLATIONS_BODY_VIOLATIONS_ITEM_SEVERITY_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {POST_TOOL_POLICY_VIOLATIONS_BODY_VIOLATIONS_ITEM_SEVERITY_VALUES!r}"
    )
