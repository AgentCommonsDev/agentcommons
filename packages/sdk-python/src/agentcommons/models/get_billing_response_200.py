from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.get_billing_response_200_plan import (
    GetBillingResponse200Plan,
    check_get_billing_response_200_plan,
)

T = TypeVar("T", bound="GetBillingResponse200")


@_attrs_define
class GetBillingResponse200:
    """
    Attributes:
        plan (GetBillingResponse200Plan):
        period_start (datetime.datetime):
        period_end (datetime.datetime):
        records_used (int):
        included_records (int | None):
        remaining (int | None):
        overage_records (int):
        embedding_messages_used (int):
        estimated_capture_usd (float | None):
        estimated_embedding_usd (float | None):
        metering_pending (int):
        metering_reconciliation_required (int):
        can_manage (bool):
        checkout_enabled (bool):
        portal_enabled (bool):
        cal_com_url (None | str):
    """

    plan: GetBillingResponse200Plan
    period_start: datetime.datetime
    period_end: datetime.datetime
    records_used: int
    included_records: int | None
    remaining: int | None
    overage_records: int
    embedding_messages_used: int
    estimated_capture_usd: float | None
    estimated_embedding_usd: float | None
    metering_pending: int
    metering_reconciliation_required: int
    can_manage: bool
    checkout_enabled: bool
    portal_enabled: bool
    cal_com_url: None | str

    def to_dict(self) -> dict[str, Any]:
        plan: str = self.plan

        period_start = self.period_start.isoformat()

        period_end = self.period_end.isoformat()

        records_used = self.records_used

        included_records: int | None
        included_records = self.included_records

        remaining: int | None
        remaining = self.remaining

        overage_records = self.overage_records

        embedding_messages_used = self.embedding_messages_used

        estimated_capture_usd: float | None
        estimated_capture_usd = self.estimated_capture_usd

        estimated_embedding_usd: float | None
        estimated_embedding_usd = self.estimated_embedding_usd

        metering_pending = self.metering_pending

        metering_reconciliation_required = self.metering_reconciliation_required

        can_manage = self.can_manage

        checkout_enabled = self.checkout_enabled

        portal_enabled = self.portal_enabled

        cal_com_url: None | str
        cal_com_url = self.cal_com_url

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "plan": plan,
                "period_start": period_start,
                "period_end": period_end,
                "records_used": records_used,
                "included_records": included_records,
                "remaining": remaining,
                "overage_records": overage_records,
                "embedding_messages_used": embedding_messages_used,
                "estimated_capture_usd": estimated_capture_usd,
                "estimated_embedding_usd": estimated_embedding_usd,
                "metering_pending": metering_pending,
                "metering_reconciliation_required": metering_reconciliation_required,
                "can_manage": can_manage,
                "checkout_enabled": checkout_enabled,
                "portal_enabled": portal_enabled,
                "cal_com_url": cal_com_url,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        plan = check_get_billing_response_200_plan(d.pop("plan"))

        period_start = datetime.datetime.fromisoformat(d.pop("period_start"))

        period_end = datetime.datetime.fromisoformat(d.pop("period_end"))

        records_used = d.pop("records_used")

        def _parse_included_records(data: object) -> int | None:
            if data is None:
                return data
            return cast(int | None, data)

        included_records = _parse_included_records(d.pop("included_records"))

        def _parse_remaining(data: object) -> int | None:
            if data is None:
                return data
            return cast(int | None, data)

        remaining = _parse_remaining(d.pop("remaining"))

        overage_records = d.pop("overage_records")

        embedding_messages_used = d.pop("embedding_messages_used")

        def _parse_estimated_capture_usd(data: object) -> float | None:
            if data is None:
                return data
            return cast(float | None, data)

        estimated_capture_usd = _parse_estimated_capture_usd(
            d.pop("estimated_capture_usd")
        )

        def _parse_estimated_embedding_usd(data: object) -> float | None:
            if data is None:
                return data
            return cast(float | None, data)

        estimated_embedding_usd = _parse_estimated_embedding_usd(
            d.pop("estimated_embedding_usd")
        )

        metering_pending = d.pop("metering_pending")

        metering_reconciliation_required = d.pop("metering_reconciliation_required")

        can_manage = d.pop("can_manage")

        checkout_enabled = d.pop("checkout_enabled")

        portal_enabled = d.pop("portal_enabled")

        def _parse_cal_com_url(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        cal_com_url = _parse_cal_com_url(d.pop("cal_com_url"))

        get_billing_response_200 = cls(
            plan=plan,
            period_start=period_start,
            period_end=period_end,
            records_used=records_used,
            included_records=included_records,
            remaining=remaining,
            overage_records=overage_records,
            embedding_messages_used=embedding_messages_used,
            estimated_capture_usd=estimated_capture_usd,
            estimated_embedding_usd=estimated_embedding_usd,
            metering_pending=metering_pending,
            metering_reconciliation_required=metering_reconciliation_required,
            can_manage=can_manage,
            checkout_enabled=checkout_enabled,
            portal_enabled=portal_enabled,
            cal_com_url=cal_com_url,
        )

        return get_billing_response_200
