from typing import Literal

GetMeResponse200Onboarding = Literal[
    "contact_admin", "create_organization", "not_applicable", "ready", "verify_email"
]

GET_ME_RESPONSE_200_ONBOARDING_VALUES: set[GetMeResponse200Onboarding] = {
    "contact_admin",
    "create_organization",
    "not_applicable",
    "ready",
    "verify_email",
}


def check_get_me_response_200_onboarding(value: str) -> GetMeResponse200Onboarding:
    if value in GET_ME_RESPONSE_200_ONBOARDING_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ME_RESPONSE_200_ONBOARDING_VALUES!r}"
    )
