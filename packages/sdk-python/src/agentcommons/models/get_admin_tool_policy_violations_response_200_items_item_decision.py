from typing import Literal

GetAdminToolPolicyViolationsResponse200ItemsItemDecision = Literal[
    "allow", "deny", "warn"
]

GET_ADMIN_TOOL_POLICY_VIOLATIONS_RESPONSE_200_ITEMS_ITEM_DECISION_VALUES: set[
    GetAdminToolPolicyViolationsResponse200ItemsItemDecision
] = {
    "allow",
    "deny",
    "warn",
}


def check_get_admin_tool_policy_violations_response_200_items_item_decision(
    value: str,
) -> GetAdminToolPolicyViolationsResponse200ItemsItemDecision:
    if (
        value
        in GET_ADMIN_TOOL_POLICY_VIOLATIONS_RESPONSE_200_ITEMS_ITEM_DECISION_VALUES
    ):
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ADMIN_TOOL_POLICY_VIOLATIONS_RESPONSE_200_ITEMS_ITEM_DECISION_VALUES!r}"
    )
