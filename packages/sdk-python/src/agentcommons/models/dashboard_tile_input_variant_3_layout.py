from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="DashboardTileInputVariant3Layout")


@_attrs_define
class DashboardTileInputVariant3Layout:
    """
    Attributes:
        x (int):
        y (int):
        w (int):
        h (int):
    """

    x: int
    y: int
    w: int
    h: int

    def to_dict(self) -> dict[str, Any]:
        x = self.x

        y = self.y

        w = self.w

        h = self.h

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "x": x,
                "y": y,
                "w": w,
                "h": h,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        x = d.pop("x")

        y = d.pop("y")

        w = d.pop("w")

        h = d.pop("h")

        dashboard_tile_input_variant_3_layout = cls(
            x=x,
            y=y,
            w=w,
            h=h,
        )

        return dashboard_tile_input_variant_3_layout
