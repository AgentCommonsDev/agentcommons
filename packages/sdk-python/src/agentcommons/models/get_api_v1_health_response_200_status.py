from typing import Literal

GetApiV1HealthResponse200Status = Literal["ok", "unavailable"]

GET_API_V1_HEALTH_RESPONSE_200_STATUS_VALUES: set[GetApiV1HealthResponse200Status] = {
    "ok",
    "unavailable",
}


def check_get_api_v1_health_response_200_status(
    value: str,
) -> GetApiV1HealthResponse200Status:
    if value in GET_API_V1_HEALTH_RESPONSE_200_STATUS_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_API_V1_HEALTH_RESPONSE_200_STATUS_VALUES!r}"
    )
