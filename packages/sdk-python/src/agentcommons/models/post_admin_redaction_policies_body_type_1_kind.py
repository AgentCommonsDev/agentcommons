from typing import Literal

PostAdminRedactionPoliciesBodyType1Kind = Literal["SECRETLINT_RULE"]

POST_ADMIN_REDACTION_POLICIES_BODY_TYPE_1_KIND_VALUES: set[
    PostAdminRedactionPoliciesBodyType1Kind
] = {
    "SECRETLINT_RULE",
}


def check_post_admin_redaction_policies_body_type_1_kind(
    value: str,
) -> PostAdminRedactionPoliciesBodyType1Kind:
    if value in POST_ADMIN_REDACTION_POLICIES_BODY_TYPE_1_KIND_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {POST_ADMIN_REDACTION_POLICIES_BODY_TYPE_1_KIND_VALUES!r}"
    )
