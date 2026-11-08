from typing import Literal

GetAdminRedactionPoliciesResponse200ItemsItemKind = Literal["REGEX", "SECRETLINT_RULE"]

GET_ADMIN_REDACTION_POLICIES_RESPONSE_200_ITEMS_ITEM_KIND_VALUES: set[
    GetAdminRedactionPoliciesResponse200ItemsItemKind
] = {
    "REGEX",
    "SECRETLINT_RULE",
}


def check_get_admin_redaction_policies_response_200_items_item_kind(
    value: str,
) -> GetAdminRedactionPoliciesResponse200ItemsItemKind:
    if value in GET_ADMIN_REDACTION_POLICIES_RESPONSE_200_ITEMS_ITEM_KIND_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ADMIN_REDACTION_POLICIES_RESPONSE_200_ITEMS_ITEM_KIND_VALUES!r}"
    )
