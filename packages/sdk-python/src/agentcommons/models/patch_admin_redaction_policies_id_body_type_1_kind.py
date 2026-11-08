from typing import Literal

PatchAdminRedactionPoliciesIdBodyType1Kind = Literal["SECRETLINT_RULE"]

PATCH_ADMIN_REDACTION_POLICIES_ID_BODY_TYPE_1_KIND_VALUES: set[
    PatchAdminRedactionPoliciesIdBodyType1Kind
] = {
    "SECRETLINT_RULE",
}


def check_patch_admin_redaction_policies_id_body_type_1_kind(
    value: str,
) -> PatchAdminRedactionPoliciesIdBodyType1Kind:
    if value in PATCH_ADMIN_REDACTION_POLICIES_ID_BODY_TYPE_1_KIND_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {PATCH_ADMIN_REDACTION_POLICIES_ID_BODY_TYPE_1_KIND_VALUES!r}"
    )
