from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.get_api_v1_billing_config_response_200_plans_pro_monthly_price_usd import (
    GetApiV1BillingConfigResponse200PlansProMonthlyPriceUsd,
    check_get_api_v1_billing_config_response_200_plans_pro_monthly_price_usd,
)

T = TypeVar("T", bound="GetApiV1BillingConfigResponse200PlansPro")


@_attrs_define
class GetApiV1BillingConfigResponse200PlansPro:
    """
    Attributes:
        included_records (int):
        monthly_price_usd (GetApiV1BillingConfigResponse200PlansProMonthlyPriceUsd):  Default: 100.
        capture_usd_per_1000 (float | None):
    """

    included_records: int
    capture_usd_per_1000: float | None
    monthly_price_usd: GetApiV1BillingConfigResponse200PlansProMonthlyPriceUsd = 100

    def to_dict(self) -> dict[str, Any]:
        included_records = self.included_records

        monthly_price_usd: int = self.monthly_price_usd

        capture_usd_per_1000: float | None
        capture_usd_per_1000 = self.capture_usd_per_1000

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "included_records": included_records,
                "monthly_price_usd": monthly_price_usd,
                "capture_usd_per_1000": capture_usd_per_1000,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        included_records = d.pop("included_records")

        monthly_price_usd = (
            check_get_api_v1_billing_config_response_200_plans_pro_monthly_price_usd(
                d.pop("monthly_price_usd")
            )
        )

        def _parse_capture_usd_per_1000(data: object) -> float | None:
            if data is None:
                return data
            return cast(float | None, data)

        capture_usd_per_1000 = _parse_capture_usd_per_1000(
            d.pop("capture_usd_per_1000")
        )

        get_api_v1_billing_config_response_200_plans_pro = cls(
            included_records=included_records,
            monthly_price_usd=monthly_price_usd,
            capture_usd_per_1000=capture_usd_per_1000,
        )

        return get_api_v1_billing_config_response_200_plans_pro
