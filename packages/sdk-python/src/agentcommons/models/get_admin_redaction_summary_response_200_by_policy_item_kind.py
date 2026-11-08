from typing import Literal

GetAdminRedactionSummaryResponse200ByPolicyItemKind = Literal[
    "REGEX", "SECRETLINT_RULE"
]

GET_ADMIN_REDACTION_SUMMARY_RESPONSE_200_BY_POLICY_ITEM_KIND_VALUES: set[
    GetAdminRedactionSummaryResponse200ByPolicyItemKind
] = {
    "REGEX",
    "SECRETLINT_RULE",
}


def check_get_admin_redaction_summary_response_200_by_policy_item_kind(
    value: str,
) -> GetAdminRedactionSummaryResponse200ByPolicyItemKind:
    if value in GET_ADMIN_REDACTION_SUMMARY_RESPONSE_200_BY_POLICY_ITEM_KIND_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ADMIN_REDACTION_SUMMARY_RESPONSE_200_BY_POLICY_ITEM_KIND_VALUES!r}"
    )
