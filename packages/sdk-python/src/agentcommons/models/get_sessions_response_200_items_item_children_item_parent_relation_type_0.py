from typing import Literal

GetSessionsResponse200ItemsItemChildrenItemParentRelationType0 = Literal[
    "FORK", "SPAWNED", "SUBAGENT"
]

GET_SESSIONS_RESPONSE_200_ITEMS_ITEM_CHILDREN_ITEM_PARENT_RELATION_TYPE_0_VALUES: set[
    GetSessionsResponse200ItemsItemChildrenItemParentRelationType0
] = {
    "FORK",
    "SPAWNED",
    "SUBAGENT",
}


def check_get_sessions_response_200_items_item_children_item_parent_relation_type_0(
    value: str,
) -> GetSessionsResponse200ItemsItemChildrenItemParentRelationType0:
    if (
        value
        in GET_SESSIONS_RESPONSE_200_ITEMS_ITEM_CHILDREN_ITEM_PARENT_RELATION_TYPE_0_VALUES
    ):
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_SESSIONS_RESPONSE_200_ITEMS_ITEM_CHILDREN_ITEM_PARENT_RELATION_TYPE_0_VALUES!r}"
    )
