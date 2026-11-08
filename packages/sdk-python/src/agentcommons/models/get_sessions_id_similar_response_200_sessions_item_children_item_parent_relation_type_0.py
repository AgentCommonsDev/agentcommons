from typing import Literal

GetSessionsIdSimilarResponse200SessionsItemChildrenItemParentRelationType0 = Literal[
    "FORK", "SPAWNED", "SUBAGENT"
]

GET_SESSIONS_ID_SIMILAR_RESPONSE_200_SESSIONS_ITEM_CHILDREN_ITEM_PARENT_RELATION_TYPE_0_VALUES: set[
    GetSessionsIdSimilarResponse200SessionsItemChildrenItemParentRelationType0
] = {
    "FORK",
    "SPAWNED",
    "SUBAGENT",
}


def check_get_sessions_id_similar_response_200_sessions_item_children_item_parent_relation_type_0(
    value: str,
) -> GetSessionsIdSimilarResponse200SessionsItemChildrenItemParentRelationType0:
    if (
        value
        in GET_SESSIONS_ID_SIMILAR_RESPONSE_200_SESSIONS_ITEM_CHILDREN_ITEM_PARENT_RELATION_TYPE_0_VALUES
    ):
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_SESSIONS_ID_SIMILAR_RESPONSE_200_SESSIONS_ITEM_CHILDREN_ITEM_PARENT_RELATION_TYPE_0_VALUES!r}"
    )
