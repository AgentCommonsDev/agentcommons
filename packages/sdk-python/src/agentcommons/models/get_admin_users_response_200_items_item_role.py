from typing import Literal

GetAdminUsersResponse200ItemsItemRole = Literal["admin", "member", "owner"]

GET_ADMIN_USERS_RESPONSE_200_ITEMS_ITEM_ROLE_VALUES: set[
    GetAdminUsersResponse200ItemsItemRole
] = {
    "admin",
    "member",
    "owner",
}


def check_get_admin_users_response_200_items_item_role(
    value: str,
) -> GetAdminUsersResponse200ItemsItemRole:
    if value in GET_ADMIN_USERS_RESPONSE_200_ITEMS_ITEM_ROLE_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ADMIN_USERS_RESPONSE_200_ITEMS_ITEM_ROLE_VALUES!r}"
    )
