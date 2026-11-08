from typing import Literal

GetAdminToolPolicyViolationsOrder = Literal["asc", "desc"]

GET_ADMIN_TOOL_POLICY_VIOLATIONS_ORDER_VALUES: set[
    GetAdminToolPolicyViolationsOrder
] = {
    "asc",
    "desc",
}


def check_get_admin_tool_policy_violations_order(
    value: str,
) -> GetAdminToolPolicyViolationsOrder:
    if value in GET_ADMIN_TOOL_POLICY_VIOLATIONS_ORDER_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ADMIN_TOOL_POLICY_VIOLATIONS_ORDER_VALUES!r}"
    )
