from typing import Literal

GetSessionsIdTreeResponse200NodesItemHarness = Literal[
    "CLAUDE_CODE", "CODEX", "GEMINI_CLI", "PI"
]

GET_SESSIONS_ID_TREE_RESPONSE_200_NODES_ITEM_HARNESS_VALUES: set[
    GetSessionsIdTreeResponse200NodesItemHarness
] = {
    "CLAUDE_CODE",
    "CODEX",
    "GEMINI_CLI",
    "PI",
}


def check_get_sessions_id_tree_response_200_nodes_item_harness(
    value: str,
) -> GetSessionsIdTreeResponse200NodesItemHarness:
    if value in GET_SESSIONS_ID_TREE_RESPONSE_200_NODES_ITEM_HARNESS_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_SESSIONS_ID_TREE_RESPONSE_200_NODES_ITEM_HARNESS_VALUES!r}"
    )
