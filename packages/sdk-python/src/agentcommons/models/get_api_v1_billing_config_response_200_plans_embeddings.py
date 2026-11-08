from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.get_api_v1_billing_config_response_200_plans_embeddings_monthly_price_usd import (
    GetApiV1BillingConfigResponse200PlansEmbeddingsMonthlyPriceUsd,
    check_get_api_v1_billing_config_response_200_plans_embeddings_monthly_price_usd,
)

T = TypeVar("T", bound="GetApiV1BillingConfigResponse200PlansEmbeddings")


@_attrs_define
class GetApiV1BillingConfigResponse200PlansEmbeddings:
    """
    Attributes:
        monthly_price_usd (GetApiV1BillingConfigResponse200PlansEmbeddingsMonthlyPriceUsd):  Default: 50.
        messages_usd_per_1000 (float | None):
    """

    messages_usd_per_1000: float | None
    monthly_price_usd: GetApiV1BillingConfigResponse200PlansEmbeddingsMonthlyPriceUsd = 50

    def to_dict(self) -> dict[str, Any]:
        monthly_price_usd: int = self.monthly_price_usd

        messages_usd_per_1000: float | None
        messages_usd_per_1000 = self.messages_usd_per_1000

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "monthly_price_usd": monthly_price_usd,
                "messages_usd_per_1000": messages_usd_per_1000,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        monthly_price_usd = check_get_api_v1_billing_config_response_200_plans_embeddings_monthly_price_usd(
            d.pop("monthly_price_usd")
        )

        def _parse_messages_usd_per_1000(data: object) -> float | None:
            if data is None:
                return data
            return cast(float | None, data)

        messages_usd_per_1000 = _parse_messages_usd_per_1000(
            d.pop("messages_usd_per_1000")
        )

        get_api_v1_billing_config_response_200_plans_embeddings = cls(
            monthly_price_usd=monthly_price_usd,
            messages_usd_per_1000=messages_usd_per_1000,
        )

        return get_api_v1_billing_config_response_200_plans_embeddings
