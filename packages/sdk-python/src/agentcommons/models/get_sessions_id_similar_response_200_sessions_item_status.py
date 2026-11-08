from typing import Literal

GetSessionsIdSimilarResponse200SessionsItemStatus = Literal[
    "ACTIVE", "ENDED", "INACTIVE"
]

GET_SESSIONS_ID_SIMILAR_RESPONSE_200_SESSIONS_ITEM_STATUS_VALUES: set[
    GetSessionsIdSimilarResponse200SessionsItemStatus
] = {
    "ACTIVE",
    "ENDED",
    "INACTIVE",
}


def check_get_sessions_id_similar_response_200_sessions_item_status(
    value: str,
) -> GetSessionsIdSimilarResponse200SessionsItemStatus:
    if value in GET_SESSIONS_ID_SIMILAR_RESPONSE_200_SESSIONS_ITEM_STATUS_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_SESSIONS_ID_SIMILAR_RESPONSE_200_SESSIONS_ITEM_STATUS_VALUES!r}"
    )
