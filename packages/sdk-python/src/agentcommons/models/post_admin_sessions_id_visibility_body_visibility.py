from typing import Literal

PostAdminSessionsIdVisibilityBodyVisibility = Literal["PRIVATE", "PUBLIC"]

POST_ADMIN_SESSIONS_ID_VISIBILITY_BODY_VISIBILITY_VALUES: set[
    PostAdminSessionsIdVisibilityBodyVisibility
] = {
    "PRIVATE",
    "PUBLIC",
}


def check_post_admin_sessions_id_visibility_body_visibility(
    value: str,
) -> PostAdminSessionsIdVisibilityBodyVisibility:
    if value in POST_ADMIN_SESSIONS_ID_VISIBILITY_BODY_VISIBILITY_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {POST_ADMIN_SESSIONS_ID_VISIBILITY_BODY_VISIBILITY_VALUES!r}"
    )
