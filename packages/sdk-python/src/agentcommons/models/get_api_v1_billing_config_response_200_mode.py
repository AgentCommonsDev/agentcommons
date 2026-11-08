from typing import Literal

GetApiV1BillingConfigResponse200Mode = Literal["customer", "public", "saas"]

GET_API_V1_BILLING_CONFIG_RESPONSE_200_MODE_VALUES: set[
    GetApiV1BillingConfigResponse200Mode
] = {
    "customer",
    "public",
    "saas",
}


def check_get_api_v1_billing_config_response_200_mode(
    value: str,
) -> GetApiV1BillingConfigResponse200Mode:
    if value in GET_API_V1_BILLING_CONFIG_RESPONSE_200_MODE_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_API_V1_BILLING_CONFIG_RESPONSE_200_MODE_VALUES!r}"
    )
