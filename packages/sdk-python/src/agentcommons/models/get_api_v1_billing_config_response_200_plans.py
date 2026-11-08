from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.get_api_v1_billing_config_response_200_plans_embeddings import (
        GetApiV1BillingConfigResponse200PlansEmbeddings,
    )
    from ..models.get_api_v1_billing_config_response_200_plans_free import (
        GetApiV1BillingConfigResponse200PlansFree,
    )
    from ..models.get_api_v1_billing_config_response_200_plans_pro import (
        GetApiV1BillingConfigResponse200PlansPro,
    )


T = TypeVar("T", bound="GetApiV1BillingConfigResponse200Plans")


@_attrs_define
class GetApiV1BillingConfigResponse200Plans:
    """
    Attributes:
        free (GetApiV1BillingConfigResponse200PlansFree):
        pro (GetApiV1BillingConfigResponse200PlansPro):
        embeddings (GetApiV1BillingConfigResponse200PlansEmbeddings):
    """

    free: GetApiV1BillingConfigResponse200PlansFree
    pro: GetApiV1BillingConfigResponse200PlansPro
    embeddings: GetApiV1BillingConfigResponse200PlansEmbeddings

    def to_dict(self) -> dict[str, Any]:
        free = self.free.to_dict()

        pro = self.pro.to_dict()

        embeddings = self.embeddings.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "free": free,
                "pro": pro,
                "embeddings": embeddings,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_v1_billing_config_response_200_plans_embeddings import (
            GetApiV1BillingConfigResponse200PlansEmbeddings,  # noqa: PLC0415
        )
        from ..models.get_api_v1_billing_config_response_200_plans_free import (
            GetApiV1BillingConfigResponse200PlansFree,  # noqa: PLC0415
        )
        from ..models.get_api_v1_billing_config_response_200_plans_pro import (
            GetApiV1BillingConfigResponse200PlansPro,  # noqa: PLC0415
        )

        d = dict(src_dict)
        free = GetApiV1BillingConfigResponse200PlansFree.from_dict(d.pop("free"))

        pro = GetApiV1BillingConfigResponse200PlansPro.from_dict(d.pop("pro"))

        embeddings = GetApiV1BillingConfigResponse200PlansEmbeddings.from_dict(
            d.pop("embeddings")
        )

        get_api_v1_billing_config_response_200_plans = cls(
            free=free,
            pro=pro,
            embeddings=embeddings,
        )

        return get_api_v1_billing_config_response_200_plans
