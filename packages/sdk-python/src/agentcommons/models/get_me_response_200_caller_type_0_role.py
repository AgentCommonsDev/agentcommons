from typing import Literal

GetMeResponse200CallerType0Role = Literal["admin", "member", "owner"]

GET_ME_RESPONSE_200_CALLER_TYPE_0_ROLE_VALUES: set[GetMeResponse200CallerType0Role] = {
    "admin",
    "member",
    "owner",
}


def check_get_me_response_200_caller_type_0_role(
    value: str,
) -> GetMeResponse200CallerType0Role:
    if value in GET_ME_RESPONSE_200_CALLER_TYPE_0_ROLE_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ME_RESPONSE_200_CALLER_TYPE_0_ROLE_VALUES!r}"
    )
