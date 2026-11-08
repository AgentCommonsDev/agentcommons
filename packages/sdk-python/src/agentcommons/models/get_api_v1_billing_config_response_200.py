from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.get_api_v1_billing_config_response_200_mode import (
    GetApiV1BillingConfigResponse200Mode,
    check_get_api_v1_billing_config_response_200_mode,
)

if TYPE_CHECKING:
    from ..models.get_api_v1_billing_config_response_200_plans import (
        GetApiV1BillingConfigResponse200Plans,
    )


T = TypeVar("T", bound="GetApiV1BillingConfigResponse200")


@_attrs_define
class GetApiV1BillingConfigResponse200:
    """
    Attributes:
        mode (GetApiV1BillingConfigResponse200Mode):
        enabled (bool):
        plans (GetApiV1BillingConfigResponse200Plans):
        checkout_enabled (bool):
        cal_com_url (None | str):
    """

    mode: GetApiV1BillingConfigResponse200Mode
    enabled: bool
    plans: GetApiV1BillingConfigResponse200Plans
    checkout_enabled: bool
    cal_com_url: None | str

    def to_dict(self) -> dict[str, Any]:
        mode: str = self.mode

        enabled = self.enabled

        plans = self.plans.to_dict()

        checkout_enabled = self.checkout_enabled

        cal_com_url: None | str
        cal_com_url = self.cal_com_url

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "mode": mode,
                "enabled": enabled,
                "plans": plans,
                "checkout_enabled": checkout_enabled,
                "cal_com_url": cal_com_url,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_v1_billing_config_response_200_plans import (
            GetApiV1BillingConfigResponse200Plans,  # noqa: PLC0415
        )

        d = dict(src_dict)
        mode = check_get_api_v1_billing_config_response_200_mode(d.pop("mode"))

        enabled = d.pop("enabled")

        plans = GetApiV1BillingConfigResponse200Plans.from_dict(d.pop("plans"))

        checkout_enabled = d.pop("checkout_enabled")

        def _parse_cal_com_url(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        cal_com_url = _parse_cal_com_url(d.pop("cal_com_url"))

        get_api_v1_billing_config_response_200 = cls(
            mode=mode,
            enabled=enabled,
            plans=plans,
            checkout_enabled=checkout_enabled,
            cal_com_url=cal_com_url,
        )

        return get_api_v1_billing_config_response_200
