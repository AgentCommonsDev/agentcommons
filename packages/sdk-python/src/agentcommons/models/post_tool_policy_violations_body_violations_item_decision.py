from typing import Literal

PostToolPolicyViolationsBodyViolationsItemDecision = Literal["deny", "warn"]

POST_TOOL_POLICY_VIOLATIONS_BODY_VIOLATIONS_ITEM_DECISION_VALUES: set[
    PostToolPolicyViolationsBodyViolationsItemDecision
] = {
    "deny",
    "warn",
}


def check_post_tool_policy_violations_body_violations_item_decision(
    value: str,
) -> PostToolPolicyViolationsBodyViolationsItemDecision:
    if value in POST_TOOL_POLICY_VIOLATIONS_BODY_VIOLATIONS_ITEM_DECISION_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {POST_TOOL_POLICY_VIOLATIONS_BODY_VIOLATIONS_ITEM_DECISION_VALUES!r}"
    )
