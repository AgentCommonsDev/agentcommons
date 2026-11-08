from typing import Literal

GetSessionsIdTreeResponse200NodesItemStatus = Literal["ACTIVE", "ENDED", "INACTIVE"]

GET_SESSIONS_ID_TREE_RESPONSE_200_NODES_ITEM_STATUS_VALUES: set[
    GetSessionsIdTreeResponse200NodesItemStatus
] = {
    "ACTIVE",
    "ENDED",
    "INACTIVE",
}


def check_get_sessions_id_tree_response_200_nodes_item_status(
    value: str,
) -> GetSessionsIdTreeResponse200NodesItemStatus:
    if value in GET_SESSIONS_ID_TREE_RESPONSE_200_NODES_ITEM_STATUS_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_SESSIONS_ID_TREE_RESPONSE_200_NODES_ITEM_STATUS_VALUES!r}"
    )
