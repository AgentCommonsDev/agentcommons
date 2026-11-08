from typing import Literal

PatchAdminUsersIdRoleBodyRole = Literal["admin", "member", "owner"]

PATCH_ADMIN_USERS_ID_ROLE_BODY_ROLE_VALUES: set[PatchAdminUsersIdRoleBodyRole] = {
    "admin",
    "member",
    "owner",
}


def check_patch_admin_users_id_role_body_role(
    value: str,
) -> PatchAdminUsersIdRoleBodyRole:
    if value in PATCH_ADMIN_USERS_ID_ROLE_BODY_ROLE_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {PATCH_ADMIN_USERS_ID_ROLE_BODY_ROLE_VALUES!r}"
    )
