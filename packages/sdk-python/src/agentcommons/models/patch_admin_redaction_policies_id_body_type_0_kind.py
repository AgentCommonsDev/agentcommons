from typing import Literal

PatchAdminRedactionPoliciesIdBodyType0Kind = Literal["REGEX"]

PATCH_ADMIN_REDACTION_POLICIES_ID_BODY_TYPE_0_KIND_VALUES: set[
    PatchAdminRedactionPoliciesIdBodyType0Kind
] = {
    "REGEX",
}


def check_patch_admin_redaction_policies_id_body_type_0_kind(
    value: str,
) -> PatchAdminRedactionPoliciesIdBodyType0Kind:
    if value in PATCH_ADMIN_REDACTION_POLICIES_ID_BODY_TYPE_0_KIND_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {PATCH_ADMIN_REDACTION_POLICIES_ID_BODY_TYPE_0_KIND_VALUES!r}"
    )
