from typing import Literal

PostAdminRedactionPoliciesBodyType0Kind = Literal["REGEX"]

POST_ADMIN_REDACTION_POLICIES_BODY_TYPE_0_KIND_VALUES: set[
    PostAdminRedactionPoliciesBodyType0Kind
] = {
    "REGEX",
}


def check_post_admin_redaction_policies_body_type_0_kind(
    value: str,
) -> PostAdminRedactionPoliciesBodyType0Kind:
    if value in POST_ADMIN_REDACTION_POLICIES_BODY_TYPE_0_KIND_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {POST_ADMIN_REDACTION_POLICIES_BODY_TYPE_0_KIND_VALUES!r}"
    )
