from typing import Literal

GetApiV1BillingConfigResponse200PlansProMonthlyPriceUsd = Literal[100]

GET_API_V1_BILLING_CONFIG_RESPONSE_200_PLANS_PRO_MONTHLY_PRICE_USD_VALUES: set[
    GetApiV1BillingConfigResponse200PlansProMonthlyPriceUsd
] = {
    100,
}


def check_get_api_v1_billing_config_response_200_plans_pro_monthly_price_usd(
    value: int,
) -> GetApiV1BillingConfigResponse200PlansProMonthlyPriceUsd:
    if (
        value
        in GET_API_V1_BILLING_CONFIG_RESPONSE_200_PLANS_PRO_MONTHLY_PRICE_USD_VALUES
    ):
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_API_V1_BILLING_CONFIG_RESPONSE_200_PLANS_PRO_MONTHLY_PRICE_USD_VALUES!r}"
    )
