from typing import Literal

PostAdminRedactionPoliciesResponse200Kind = Literal["REGEX", "SECRETLINT_RULE"]

POST_ADMIN_REDACTION_POLICIES_RESPONSE_200_KIND_VALUES: set[
    PostAdminRedactionPoliciesResponse200Kind
] = {
    "REGEX",
    "SECRETLINT_RULE",
}


def check_post_admin_redaction_policies_response_200_kind(
    value: str,
) -> PostAdminRedactionPoliciesResponse200Kind:
    if value in POST_ADMIN_REDACTION_POLICIES_RESPONSE_200_KIND_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {POST_ADMIN_REDACTION_POLICIES_RESPONSE_200_KIND_VALUES!r}"
    )
