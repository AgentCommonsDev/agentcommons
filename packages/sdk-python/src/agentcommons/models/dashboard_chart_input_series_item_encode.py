from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="DashboardChartInputSeriesItemEncode")


@_attrs_define
class DashboardChartInputSeriesItemEncode:
    """
    Attributes:
        x (str | Unset):
        y (list[str] | str | Unset):
        value (str | Unset):
        item_name (str | Unset):
        tooltip (list[str] | Unset):
    """

    x: str | Unset = UNSET
    y: list[str] | str | Unset = UNSET
    value: str | Unset = UNSET
    item_name: str | Unset = UNSET
    tooltip: list[str] | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        x = self.x

        y: list[str] | str | Unset
        if isinstance(self.y, Unset):
            y = UNSET
        elif isinstance(self.y, list):
            y = self.y

        else:
            y = self.y

        value = self.value

        item_name = self.item_name

        tooltip: list[str] | Unset = UNSET
        if not isinstance(self.tooltip, Unset):
            tooltip = self.tooltip

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if x is not UNSET:
            field_dict["x"] = x
        if y is not UNSET:
            field_dict["y"] = y
        if value is not UNSET:
            field_dict["value"] = value
        if item_name is not UNSET:
            field_dict["itemName"] = item_name
        if tooltip is not UNSET:
            field_dict["tooltip"] = tooltip

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        x = d.pop("x", UNSET)

        def _parse_y(data: object) -> list[str] | str | Unset:
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, list):
                    raise TypeError()
                y_type_1 = cast(list[str], data)

                return y_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(list[str] | str | Unset, data)

        y = _parse_y(d.pop("y", UNSET))

        value = d.pop("value", UNSET)

        item_name = d.pop("itemName", UNSET)

        tooltip = cast(list[str], d.pop("tooltip", UNSET))

        dashboard_chart_input_series_item_encode = cls(
            x=x,
            y=y,
            value=value,
            item_name=item_name,
            tooltip=tooltip,
        )

        return dashboard_chart_input_series_item_encode
