from typing import Literal

GetAdminSessionsResponse200ItemsItemParentRelationType0 = Literal[
    "FORK", "SPAWNED", "SUBAGENT"
]

GET_ADMIN_SESSIONS_RESPONSE_200_ITEMS_ITEM_PARENT_RELATION_TYPE_0_VALUES: set[
    GetAdminSessionsResponse200ItemsItemParentRelationType0
] = {
    "FORK",
    "SPAWNED",
    "SUBAGENT",
}


def check_get_admin_sessions_response_200_items_item_parent_relation_type_0(
    value: str,
) -> GetAdminSessionsResponse200ItemsItemParentRelationType0:
    if (
        value
        in GET_ADMIN_SESSIONS_RESPONSE_200_ITEMS_ITEM_PARENT_RELATION_TYPE_0_VALUES
    ):
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ADMIN_SESSIONS_RESPONSE_200_ITEMS_ITEM_PARENT_RELATION_TYPE_0_VALUES!r}"
    )
