from typing import Literal

GetSessionsIdResponse200HeaderType0Visibility = Literal["PRIVATE", "PUBLIC"]

GET_SESSIONS_ID_RESPONSE_200_HEADER_TYPE_0_VISIBILITY_VALUES: set[
    GetSessionsIdResponse200HeaderType0Visibility
] = {
    "PRIVATE",
    "PUBLIC",
}


def check_get_sessions_id_response_200_header_type_0_visibility(
    value: str,
) -> GetSessionsIdResponse200HeaderType0Visibility:
    if value in GET_SESSIONS_ID_RESPONSE_200_HEADER_TYPE_0_VISIBILITY_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_SESSIONS_ID_RESPONSE_200_HEADER_TYPE_0_VISIBILITY_VALUES!r}"
    )
