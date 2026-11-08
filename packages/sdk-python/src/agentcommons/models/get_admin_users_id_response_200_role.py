from typing import Literal

GetAdminUsersIdResponse200Role = Literal["admin", "member", "owner"]

GET_ADMIN_USERS_ID_RESPONSE_200_ROLE_VALUES: set[GetAdminUsersIdResponse200Role] = {
    "admin",
    "member",
    "owner",
}


def check_get_admin_users_id_response_200_role(
    value: str,
) -> GetAdminUsersIdResponse200Role:
    if value in GET_ADMIN_USERS_ID_RESPONSE_200_ROLE_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ADMIN_USERS_ID_RESPONSE_200_ROLE_VALUES!r}"
    )
