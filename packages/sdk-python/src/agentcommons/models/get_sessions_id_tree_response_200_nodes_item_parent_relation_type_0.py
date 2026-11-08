from typing import Literal

GetSessionsIdTreeResponse200NodesItemParentRelationType0 = Literal[
    "FORK", "SPAWNED", "SUBAGENT"
]

GET_SESSIONS_ID_TREE_RESPONSE_200_NODES_ITEM_PARENT_RELATION_TYPE_0_VALUES: set[
    GetSessionsIdTreeResponse200NodesItemParentRelationType0
] = {
    "FORK",
    "SPAWNED",
    "SUBAGENT",
}


def check_get_sessions_id_tree_response_200_nodes_item_parent_relation_type_0(
    value: str,
) -> GetSessionsIdTreeResponse200NodesItemParentRelationType0:
    if (
        value
        in GET_SESSIONS_ID_TREE_RESPONSE_200_NODES_ITEM_PARENT_RELATION_TYPE_0_VALUES
    ):
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_SESSIONS_ID_TREE_RESPONSE_200_NODES_ITEM_PARENT_RELATION_TYPE_0_VALUES!r}"
    )
