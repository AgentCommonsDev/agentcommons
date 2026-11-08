from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="DeleteDashboardsIdBodyType0")


@_attrs_define
class DeleteDashboardsIdBodyType0:
    def to_dict(self) -> dict[str, Any]:

        field_dict: dict[str, Any] = {}

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        delete_dashboards_id_body_type_0 = cls()

        return delete_dashboards_id_body_type_0
