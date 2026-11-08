from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.get_admin_redaction_summary_response_200_by_policy_item import (
        GetAdminRedactionSummaryResponse200ByPolicyItem,
    )
    from ..models.get_admin_redaction_summary_response_200_last_7_days import (
        GetAdminRedactionSummaryResponse200Last7Days,
    )
    from ..models.get_admin_redaction_summary_response_200_last_30_days import (
        GetAdminRedactionSummaryResponse200Last30Days,
    )
    from ..models.get_admin_redaction_summary_response_200_runs import (
        GetAdminRedactionSummaryResponse200Runs,
    )


T = TypeVar("T", bound="GetAdminRedactionSummaryResponse200")


@_attrs_define
class GetAdminRedactionSummaryResponse200:
    """
    Attributes:
        total (int):
        sessions (int):
        last_7_days (GetAdminRedactionSummaryResponse200Last7Days):
        last_30_days (GetAdminRedactionSummaryResponse200Last30Days):
        by_policy (list[GetAdminRedactionSummaryResponse200ByPolicyItem]):
        runs (GetAdminRedactionSummaryResponse200Runs):
    """

    total: int
    sessions: int
    last_7_days: GetAdminRedactionSummaryResponse200Last7Days
    last_30_days: GetAdminRedactionSummaryResponse200Last30Days
    by_policy: list[GetAdminRedactionSummaryResponse200ByPolicyItem]
    runs: GetAdminRedactionSummaryResponse200Runs

    def to_dict(self) -> dict[str, Any]:
        total = self.total

        sessions = self.sessions

        last_7_days = self.last_7_days.to_dict()

        last_30_days = self.last_30_days.to_dict()

        by_policy = []
        for by_policy_item_data in self.by_policy:
            by_policy_item = by_policy_item_data.to_dict()
            by_policy.append(by_policy_item)

        runs = self.runs.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "total": total,
                "sessions": sessions,
                "last_7_days": last_7_days,
                "last_30_days": last_30_days,
                "by_policy": by_policy,
                "runs": runs,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_admin_redaction_summary_response_200_by_policy_item import (
            GetAdminRedactionSummaryResponse200ByPolicyItem,  # noqa: PLC0415
        )
        from ..models.get_admin_redaction_summary_response_200_last_7_days import (
            GetAdminRedactionSummaryResponse200Last7Days,  # noqa: PLC0415
        )
        from ..models.get_admin_redaction_summary_response_200_last_30_days import (
            GetAdminRedactionSummaryResponse200Last30Days,  # noqa: PLC0415
        )
        from ..models.get_admin_redaction_summary_response_200_runs import (
            GetAdminRedactionSummaryResponse200Runs,  # noqa: PLC0415
        )

        d = dict(src_dict)
        total = d.pop("total")

        sessions = d.pop("sessions")

        last_7_days = GetAdminRedactionSummaryResponse200Last7Days.from_dict(
            d.pop("last_7_days")
        )

        last_30_days = GetAdminRedactionSummaryResponse200Last30Days.from_dict(
            d.pop("last_30_days")
        )

        by_policy = []
        _by_policy = d.pop("by_policy")
        for by_policy_item_data in _by_policy:
            by_policy_item = GetAdminRedactionSummaryResponse200ByPolicyItem.from_dict(
                by_policy_item_data
            )

            by_policy.append(by_policy_item)

        runs = GetAdminRedactionSummaryResponse200Runs.from_dict(d.pop("runs"))

        get_admin_redaction_summary_response_200 = cls(
            total=total,
            sessions=sessions,
            last_7_days=last_7_days,
            last_30_days=last_30_days,
            by_policy=by_policy,
            runs=runs,
        )

        return get_admin_redaction_summary_response_200
