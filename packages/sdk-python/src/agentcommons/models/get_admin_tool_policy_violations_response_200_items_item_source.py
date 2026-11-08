from typing import Literal

GetAdminToolPolicyViolationsResponse200ItemsItemSource = Literal["hook", "projection"]

GET_ADMIN_TOOL_POLICY_VIOLATIONS_RESPONSE_200_ITEMS_ITEM_SOURCE_VALUES: set[
    GetAdminToolPolicyViolationsResponse200ItemsItemSource
] = {
    "hook",
    "projection",
}


def check_get_admin_tool_policy_violations_response_200_items_item_source(
    value: str,
) -> GetAdminToolPolicyViolationsResponse200ItemsItemSource:
    if value in GET_ADMIN_TOOL_POLICY_VIOLATIONS_RESPONSE_200_ITEMS_ITEM_SOURCE_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ADMIN_TOOL_POLICY_VIOLATIONS_RESPONSE_200_ITEMS_ITEM_SOURCE_VALUES!r}"
    )
