from typing import Literal

PostAdminUsersBodyRole = Literal["admin", "member", "owner"]

POST_ADMIN_USERS_BODY_ROLE_VALUES: set[PostAdminUsersBodyRole] = {
    "admin",
    "member",
    "owner",
}


def check_post_admin_users_body_role(value: str) -> PostAdminUsersBodyRole:
    if value in POST_ADMIN_USERS_BODY_ROLE_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {POST_ADMIN_USERS_BODY_ROLE_VALUES!r}"
    )
