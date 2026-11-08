from typing import Literal

GetAdminToolPolicyViolationsFormat = Literal["csv", "json"]

GET_ADMIN_TOOL_POLICY_VIOLATIONS_FORMAT_VALUES: set[
    GetAdminToolPolicyViolationsFormat
] = {
    "csv",
    "json",
}


def check_get_admin_tool_policy_violations_format(
    value: str,
) -> GetAdminToolPolicyViolationsFormat:
    if value in GET_ADMIN_TOOL_POLICY_VIOLATIONS_FORMAT_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ADMIN_TOOL_POLICY_VIOLATIONS_FORMAT_VALUES!r}"
    )
