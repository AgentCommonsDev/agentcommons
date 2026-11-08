from typing import Literal

PostAdminSessionsIdPurgeResponse200Cleanup = Literal["completed", "queued"]

POST_ADMIN_SESSIONS_ID_PURGE_RESPONSE_200_CLEANUP_VALUES: set[
    PostAdminSessionsIdPurgeResponse200Cleanup
] = {
    "completed",
    "queued",
}


def check_post_admin_sessions_id_purge_response_200_cleanup(
    value: str,
) -> PostAdminSessionsIdPurgeResponse200Cleanup:
    if value in POST_ADMIN_SESSIONS_ID_PURGE_RESPONSE_200_CLEANUP_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {POST_ADMIN_SESSIONS_ID_PURGE_RESPONSE_200_CLEANUP_VALUES!r}"
    )
