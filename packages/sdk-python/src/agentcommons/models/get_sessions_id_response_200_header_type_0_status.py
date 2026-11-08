from typing import Literal

GetSessionsIdResponse200HeaderType0Status = Literal["ACTIVE", "ENDED", "INACTIVE"]

GET_SESSIONS_ID_RESPONSE_200_HEADER_TYPE_0_STATUS_VALUES: set[
    GetSessionsIdResponse200HeaderType0Status
] = {
    "ACTIVE",
    "ENDED",
    "INACTIVE",
}


def check_get_sessions_id_response_200_header_type_0_status(
    value: str,
) -> GetSessionsIdResponse200HeaderType0Status:
    if value in GET_SESSIONS_ID_RESPONSE_200_HEADER_TYPE_0_STATUS_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_SESSIONS_ID_RESPONSE_200_HEADER_TYPE_0_STATUS_VALUES!r}"
    )
