from typing import Literal

PostBillingCheckoutBodyPlan = Literal["pro", "pro_embeddings"]

POST_BILLING_CHECKOUT_BODY_PLAN_VALUES: set[PostBillingCheckoutBodyPlan] = {
    "pro",
    "pro_embeddings",
}


def check_post_billing_checkout_body_plan(value: str) -> PostBillingCheckoutBodyPlan:
    if value in POST_BILLING_CHECKOUT_BODY_PLAN_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {POST_BILLING_CHECKOUT_BODY_PLAN_VALUES!r}"
    )
