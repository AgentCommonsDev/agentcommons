from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="GetApiV1BillingConfigResponse200PlansFree")


@_attrs_define
class GetApiV1BillingConfigResponse200PlansFree:
    """
    Attributes:
        monthly_records (int):
    """

    monthly_records: int

    def to_dict(self) -> dict[str, Any]:
        monthly_records = self.monthly_records

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "monthly_records": monthly_records,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        monthly_records = d.pop("monthly_records")

        get_api_v1_billing_config_response_200_plans_free = cls(
            monthly_records=monthly_records,
        )

        return get_api_v1_billing_config_response_200_plans_free
