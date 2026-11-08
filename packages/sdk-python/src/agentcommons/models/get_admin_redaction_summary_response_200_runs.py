from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="GetAdminRedactionSummaryResponse200Runs")


@_attrs_define
class GetAdminRedactionSummaryResponse200Runs:
    """
    Attributes:
        total (int):
        active (int):
        failed (int):
    """

    total: int
    active: int
    failed: int

    def to_dict(self) -> dict[str, Any]:
        total = self.total

        active = self.active

        failed = self.failed

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "total": total,
                "active": active,
                "failed": failed,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        total = d.pop("total")

        active = d.pop("active")

        failed = d.pop("failed")

        get_admin_redaction_summary_response_200_runs = cls(
            total=total,
            active=active,
            failed=failed,
        )

        return get_admin_redaction_summary_response_200_runs
