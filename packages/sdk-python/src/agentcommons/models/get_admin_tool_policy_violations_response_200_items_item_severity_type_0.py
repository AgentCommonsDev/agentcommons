from typing import Literal

GetAdminToolPolicyViolationsResponse200ItemsItemSeverityType0 = Literal[
    "critical", "high", "low", "medium"
]

GET_ADMIN_TOOL_POLICY_VIOLATIONS_RESPONSE_200_ITEMS_ITEM_SEVERITY_TYPE_0_VALUES: set[
    GetAdminToolPolicyViolationsResponse200ItemsItemSeverityType0
] = {
    "critical",
    "high",
    "low",
    "medium",
}


def check_get_admin_tool_policy_violations_response_200_items_item_severity_type_0(
    value: str,
) -> GetAdminToolPolicyViolationsResponse200ItemsItemSeverityType0:
    if (
        value
        in GET_ADMIN_TOOL_POLICY_VIOLATIONS_RESPONSE_200_ITEMS_ITEM_SEVERITY_TYPE_0_VALUES
    ):
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ADMIN_TOOL_POLICY_VIOLATIONS_RESPONSE_200_ITEMS_ITEM_SEVERITY_TYPE_0_VALUES!r}"
    )
