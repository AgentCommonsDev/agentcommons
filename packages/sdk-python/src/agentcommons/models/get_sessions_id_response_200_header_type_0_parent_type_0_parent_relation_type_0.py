from typing import Literal

GetSessionsIdResponse200HeaderType0ParentType0ParentRelationType0 = Literal[
    "FORK", "SPAWNED", "SUBAGENT"
]

GET_SESSIONS_ID_RESPONSE_200_HEADER_TYPE_0_PARENT_TYPE_0_PARENT_RELATION_TYPE_0_VALUES: set[
    GetSessionsIdResponse200HeaderType0ParentType0ParentRelationType0
] = {
    "FORK",
    "SPAWNED",
    "SUBAGENT",
}


def check_get_sessions_id_response_200_header_type_0_parent_type_0_parent_relation_type_0(
    value: str,
) -> GetSessionsIdResponse200HeaderType0ParentType0ParentRelationType0:
    if (
        value
        in GET_SESSIONS_ID_RESPONSE_200_HEADER_TYPE_0_PARENT_TYPE_0_PARENT_RELATION_TYPE_0_VALUES
    ):
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_SESSIONS_ID_RESPONSE_200_HEADER_TYPE_0_PARENT_TYPE_0_PARENT_RELATION_TYPE_0_VALUES!r}"
    )
