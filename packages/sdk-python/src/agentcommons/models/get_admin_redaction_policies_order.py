from typing import Literal

GetAdminRedactionPoliciesOrder = Literal["asc", "desc"]

GET_ADMIN_REDACTION_POLICIES_ORDER_VALUES: set[GetAdminRedactionPoliciesOrder] = {
    "asc",
    "desc",
}


def check_get_admin_redaction_policies_order(
    value: str,
) -> GetAdminRedactionPoliciesOrder:
    if value in GET_ADMIN_REDACTION_POLICIES_ORDER_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ADMIN_REDACTION_POLICIES_ORDER_VALUES!r}"
    )
