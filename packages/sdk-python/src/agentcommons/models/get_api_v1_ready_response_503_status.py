from typing import Literal

GetApiV1ReadyResponse503Status = Literal["ok", "unavailable"]

GET_API_V1_READY_RESPONSE_503_STATUS_VALUES: set[GetApiV1ReadyResponse503Status] = {
    "ok",
    "unavailable",
}


def check_get_api_v1_ready_response_503_status(
    value: str,
) -> GetApiV1ReadyResponse503Status:
    if value in GET_API_V1_READY_RESPONSE_503_STATUS_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_API_V1_READY_RESPONSE_503_STATUS_VALUES!r}"
    )
