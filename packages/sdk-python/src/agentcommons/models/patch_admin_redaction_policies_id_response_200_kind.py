from typing import Literal

PatchAdminRedactionPoliciesIdResponse200Kind = Literal["REGEX", "SECRETLINT_RULE"]

PATCH_ADMIN_REDACTION_POLICIES_ID_RESPONSE_200_KIND_VALUES: set[
    PatchAdminRedactionPoliciesIdResponse200Kind
] = {
    "REGEX",
    "SECRETLINT_RULE",
}


def check_patch_admin_redaction_policies_id_response_200_kind(
    value: str,
) -> PatchAdminRedactionPoliciesIdResponse200Kind:
    if value in PATCH_ADMIN_REDACTION_POLICIES_ID_RESPONSE_200_KIND_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {PATCH_ADMIN_REDACTION_POLICIES_ID_RESPONSE_200_KIND_VALUES!r}"
    )
