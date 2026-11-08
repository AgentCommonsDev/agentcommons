from typing import Literal

GetAdminToolPolicyViolationsFiltersSource = Literal["hook", "projection"]

GET_ADMIN_TOOL_POLICY_VIOLATIONS_FILTERS_SOURCE_VALUES: set[
    GetAdminToolPolicyViolationsFiltersSource
] = {
    "hook",
    "projection",
}


def check_get_admin_tool_policy_violations_filters_source(
    value: str,
) -> GetAdminToolPolicyViolationsFiltersSource:
    if value in GET_ADMIN_TOOL_POLICY_VIOLATIONS_FILTERS_SOURCE_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ADMIN_TOOL_POLICY_VIOLATIONS_FILTERS_SOURCE_VALUES!r}"
    )
