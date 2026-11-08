from typing import Literal

GetReadyResponse200Status = Literal["ok", "unavailable"]

GET_READY_RESPONSE_200_STATUS_VALUES: set[GetReadyResponse200Status] = {
    "ok",
    "unavailable",
}


def check_get_ready_response_200_status(value: str) -> GetReadyResponse200Status:
    if value in GET_READY_RESPONSE_200_STATUS_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_READY_RESPONSE_200_STATUS_VALUES!r}"
    )
