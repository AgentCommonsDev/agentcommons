from typing import Literal

PostMeOrganizationResponse200OrganizationRole = Literal["admin", "member", "owner"]

POST_ME_ORGANIZATION_RESPONSE_200_ORGANIZATION_ROLE_VALUES: set[
    PostMeOrganizationResponse200OrganizationRole
] = {
    "admin",
    "member",
    "owner",
}


def check_post_me_organization_response_200_organization_role(
    value: str,
) -> PostMeOrganizationResponse200OrganizationRole:
    if value in POST_ME_ORGANIZATION_RESPONSE_200_ORGANIZATION_ROLE_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {POST_ME_ORGANIZATION_RESPONSE_200_ORGANIZATION_ROLE_VALUES!r}"
    )
