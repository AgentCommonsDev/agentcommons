from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="GetAdminStatusResponse200FailuresItem")


@_attrs_define
class GetAdminStatusResponse200FailuresItem:
    """
    Attributes:
        date (datetime.date):
        count (int):
    """

    date: datetime.date
    count: int

    def to_dict(self) -> dict[str, Any]:
        date = self.date.isoformat()

        count = self.count

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "date": date,
                "count": count,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        date = datetime.date.fromisoformat(d.pop("date"))

        count = d.pop("count")

        get_admin_status_response_200_failures_item = cls(
            date=date,
            count=count,
        )

        return get_admin_status_response_200_failures_item
