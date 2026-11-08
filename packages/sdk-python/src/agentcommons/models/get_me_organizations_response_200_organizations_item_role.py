from typing import Literal

GetMeOrganizationsResponse200OrganizationsItemRole = Literal["admin", "member", "owner"]

GET_ME_ORGANIZATIONS_RESPONSE_200_ORGANIZATIONS_ITEM_ROLE_VALUES: set[
    GetMeOrganizationsResponse200OrganizationsItemRole
] = {
    "admin",
    "member",
    "owner",
}


def check_get_me_organizations_response_200_organizations_item_role(
    value: str,
) -> GetMeOrganizationsResponse200OrganizationsItemRole:
    if value in GET_ME_ORGANIZATIONS_RESPONSE_200_ORGANIZATIONS_ITEM_ROLE_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ME_ORGANIZATIONS_RESPONSE_200_ORGANIZATIONS_ITEM_ROLE_VALUES!r}"
    )
