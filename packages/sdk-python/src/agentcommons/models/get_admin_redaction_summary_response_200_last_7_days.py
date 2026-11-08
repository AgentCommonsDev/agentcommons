from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="GetAdminRedactionSummaryResponse200Last7Days")


@_attrs_define
class GetAdminRedactionSummaryResponse200Last7Days:
    """
    Attributes:
        capture (int):
        rescan (int):
        total (int):
    """

    capture: int
    rescan: int
    total: int

    def to_dict(self) -> dict[str, Any]:
        capture = self.capture

        rescan = self.rescan

        total = self.total

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "capture": capture,
                "rescan": rescan,
                "total": total,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        capture = d.pop("capture")

        rescan = d.pop("rescan")

        total = d.pop("total")

        get_admin_redaction_summary_response_200_last_7_days = cls(
            capture=capture,
            rescan=rescan,
            total=total,
        )

        return get_admin_redaction_summary_response_200_last_7_days
