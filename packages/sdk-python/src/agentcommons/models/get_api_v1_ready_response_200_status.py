from typing import Literal

GetApiV1ReadyResponse200Status = Literal["ok", "unavailable"]

GET_API_V1_READY_RESPONSE_200_STATUS_VALUES: set[GetApiV1ReadyResponse200Status] = {
    "ok",
    "unavailable",
}


def check_get_api_v1_ready_response_200_status(
    value: str,
) -> GetApiV1ReadyResponse200Status:
    if value in GET_API_V1_READY_RESPONSE_200_STATUS_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_API_V1_READY_RESPONSE_200_STATUS_VALUES!r}"
    )
