from typing import Literal

PostAdminUsersResponse200ResultsItemStatus = Literal["added", "error", "existing"]

POST_ADMIN_USERS_RESPONSE_200_RESULTS_ITEM_STATUS_VALUES: set[
    PostAdminUsersResponse200ResultsItemStatus
] = {
    "added",
    "error",
    "existing",
}


def check_post_admin_users_response_200_results_item_status(
    value: str,
) -> PostAdminUsersResponse200ResultsItemStatus:
    if value in POST_ADMIN_USERS_RESPONSE_200_RESULTS_ITEM_STATUS_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {POST_ADMIN_USERS_RESPONSE_200_RESULTS_ITEM_STATUS_VALUES!r}"
    )
