from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.get_auth_config_response_200_features_item import (
    GetAuthConfigResponse200FeaturesItem,
    check_get_auth_config_response_200_features_item,
)
from ..models.get_auth_config_response_200_signup_mode import (
    GetAuthConfigResponse200SignupMode,
    check_get_auth_config_response_200_signup_mode,
)

T = TypeVar("T", bound="GetAuthConfigResponse200")


@_attrs_define
class GetAuthConfigResponse200:
    """
    Attributes:
        features (list[GetAuthConfigResponse200FeaturesItem]):
        email_password_enabled (bool):
        social_provider (None | str):
        oidc_enabled (bool):
        signup_mode (GetAuthConfigResponse200SignupMode):
    """

    features: list[GetAuthConfigResponse200FeaturesItem]
    email_password_enabled: bool
    social_provider: None | str
    oidc_enabled: bool
    signup_mode: GetAuthConfigResponse200SignupMode

    def to_dict(self) -> dict[str, Any]:
        features = []
        for features_item_data in self.features:
            features_item: str = features_item_data
            features.append(features_item)

        email_password_enabled = self.email_password_enabled

        social_provider: None | str
        social_provider = self.social_provider

        oidc_enabled = self.oidc_enabled

        signup_mode: str = self.signup_mode

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "features": features,
                "email_password_enabled": email_password_enabled,
                "social_provider": social_provider,
                "oidc_enabled": oidc_enabled,
                "signup_mode": signup_mode,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        features = []
        _features = d.pop("features")
        for features_item_data in _features:
            features_item = check_get_auth_config_response_200_features_item(
                features_item_data
            )

            features.append(features_item)

        email_password_enabled = d.pop("email_password_enabled")

        def _parse_social_provider(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        social_provider = _parse_social_provider(d.pop("social_provider"))

        oidc_enabled = d.pop("oidc_enabled")

        signup_mode = check_get_auth_config_response_200_signup_mode(
            d.pop("signup_mode")
        )

        get_auth_config_response_200 = cls(
            features=features,
            email_password_enabled=email_password_enabled,
            social_provider=social_provider,
            oidc_enabled=oidc_enabled,
            signup_mode=signup_mode,
        )

        return get_auth_config_response_200
