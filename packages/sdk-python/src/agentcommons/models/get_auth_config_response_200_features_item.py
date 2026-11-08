from typing import Literal

GetAuthConfigResponse200FeaturesItem = Literal["similar_sessions"]

GET_AUTH_CONFIG_RESPONSE_200_FEATURES_ITEM_VALUES: set[
    GetAuthConfigResponse200FeaturesItem
] = {
    "similar_sessions",
}


def check_get_auth_config_response_200_features_item(
    value: str,
) -> GetAuthConfigResponse200FeaturesItem:
    if value in GET_AUTH_CONFIG_RESPONSE_200_FEATURES_ITEM_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_AUTH_CONFIG_RESPONSE_200_FEATURES_ITEM_VALUES!r}"
    )
