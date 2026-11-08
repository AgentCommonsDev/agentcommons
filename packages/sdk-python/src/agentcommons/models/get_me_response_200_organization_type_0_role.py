from typing import Literal

GetMeResponse200OrganizationType0Role = Literal["admin", "member", "owner"]

GET_ME_RESPONSE_200_ORGANIZATION_TYPE_0_ROLE_VALUES: set[
    GetMeResponse200OrganizationType0Role
] = {
    "admin",
    "member",
    "owner",
}


def check_get_me_response_200_organization_type_0_role(
    value: str,
) -> GetMeResponse200OrganizationType0Role:
    if value in GET_ME_RESPONSE_200_ORGANIZATION_TYPE_0_ROLE_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ME_RESPONSE_200_ORGANIZATION_TYPE_0_ROLE_VALUES!r}"
    )
