from typing import Literal

GetReadyResponse503Status = Literal["ok", "unavailable"]

GET_READY_RESPONSE_503_STATUS_VALUES: set[GetReadyResponse503Status] = {
    "ok",
    "unavailable",
}


def check_get_ready_response_503_status(value: str) -> GetReadyResponse503Status:
    if value in GET_READY_RESPONSE_503_STATUS_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_READY_RESPONSE_503_STATUS_VALUES!r}"
    )
