from typing import Literal

GetBillingResponse200Plan = Literal["free", "pro", "pro_embeddings", "unmetered"]

GET_BILLING_RESPONSE_200_PLAN_VALUES: set[GetBillingResponse200Plan] = {
    "free",
    "pro",
    "pro_embeddings",
    "unmetered",
}


def check_get_billing_response_200_plan(value: str) -> GetBillingResponse200Plan:
    if value in GET_BILLING_RESPONSE_200_PLAN_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_BILLING_RESPONSE_200_PLAN_VALUES!r}"
    )
