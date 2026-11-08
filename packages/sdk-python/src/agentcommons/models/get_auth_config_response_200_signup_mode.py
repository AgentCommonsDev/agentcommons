from typing import Literal

GetAuthConfigResponse200SignupMode = Literal["closed", "invite", "open"]

GET_AUTH_CONFIG_RESPONSE_200_SIGNUP_MODE_VALUES: set[
    GetAuthConfigResponse200SignupMode
] = {
    "closed",
    "invite",
    "open",
}


def check_get_auth_config_response_200_signup_mode(
    value: str,
) -> GetAuthConfigResponse200SignupMode:
    if value in GET_AUTH_CONFIG_RESPONSE_200_SIGNUP_MODE_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_AUTH_CONFIG_RESPONSE_200_SIGNUP_MODE_VALUES!r}"
    )
