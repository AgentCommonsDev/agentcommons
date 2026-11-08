from typing import Literal

GetMeResponse200CallerType0AuthMethod = Literal["cookie", "key"]

GET_ME_RESPONSE_200_CALLER_TYPE_0_AUTH_METHOD_VALUES: set[
    GetMeResponse200CallerType0AuthMethod
] = {
    "cookie",
    "key",
}


def check_get_me_response_200_caller_type_0_auth_method(
    value: str,
) -> GetMeResponse200CallerType0AuthMethod:
    if value in GET_ME_RESPONSE_200_CALLER_TYPE_0_AUTH_METHOD_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ME_RESPONSE_200_CALLER_TYPE_0_AUTH_METHOD_VALUES!r}"
    )
