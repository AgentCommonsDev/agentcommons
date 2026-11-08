from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar
from uuid import UUID

from attrs import define as _attrs_define

T = TypeVar("T", bound="PostDashboardsIdDefaultResponse200")


@_attrs_define
class PostDashboardsIdDefaultResponse200:
    """
    Attributes:
        default_id (UUID):
    """

    default_id: UUID

    def to_dict(self) -> dict[str, Any]:
        default_id = str(self.default_id)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "default_id": default_id,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        default_id = UUID(d.pop("default_id"))

        post_dashboards_id_default_response_200 = cls(
            default_id=default_id,
        )

        return post_dashboards_id_default_response_200
