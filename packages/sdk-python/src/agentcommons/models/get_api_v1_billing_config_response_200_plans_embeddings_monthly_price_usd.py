from typing import Literal

GetApiV1BillingConfigResponse200PlansEmbeddingsMonthlyPriceUsd = Literal[50]

GET_API_V1_BILLING_CONFIG_RESPONSE_200_PLANS_EMBEDDINGS_MONTHLY_PRICE_USD_VALUES: set[
    GetApiV1BillingConfigResponse200PlansEmbeddingsMonthlyPriceUsd
] = {
    50,
}


def check_get_api_v1_billing_config_response_200_plans_embeddings_monthly_price_usd(
    value: int,
) -> GetApiV1BillingConfigResponse200PlansEmbeddingsMonthlyPriceUsd:
    if (
        value
        in GET_API_V1_BILLING_CONFIG_RESPONSE_200_PLANS_EMBEDDINGS_MONTHLY_PRICE_USD_VALUES
    ):
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_API_V1_BILLING_CONFIG_RESPONSE_200_PLANS_EMBEDDINGS_MONTHLY_PRICE_USD_VALUES!r}"
    )
