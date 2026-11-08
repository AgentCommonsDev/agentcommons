from typing import Literal

GetSessionsIdSimilarResponse200SessionsItemVisibility = Literal["PRIVATE", "PUBLIC"]

GET_SESSIONS_ID_SIMILAR_RESPONSE_200_SESSIONS_ITEM_VISIBILITY_VALUES: set[
    GetSessionsIdSimilarResponse200SessionsItemVisibility
] = {
    "PRIVATE",
    "PUBLIC",
}


def check_get_sessions_id_similar_response_200_sessions_item_visibility(
    value: str,
) -> GetSessionsIdSimilarResponse200SessionsItemVisibility:
    if value in GET_SESSIONS_ID_SIMILAR_RESPONSE_200_SESSIONS_ITEM_VISIBILITY_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_SESSIONS_ID_SIMILAR_RESPONSE_200_SESSIONS_ITEM_VISIBILITY_VALUES!r}"
    )
