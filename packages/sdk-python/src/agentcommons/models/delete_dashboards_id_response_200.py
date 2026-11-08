from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="DeleteDashboardsIdResponse200")


@_attrs_define
class DeleteDashboardsIdResponse200:
    """
    Attributes:
        deleted (bool):
    """

    deleted: bool

    def to_dict(self) -> dict[str, Any]:
        deleted = self.deleted

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "deleted": deleted,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        deleted = d.pop("deleted")

        delete_dashboards_id_response_200 = cls(
            deleted=deleted,
        )

        return delete_dashboards_id_response_200
