from __future__ import annotations

from collections.abc import Mapping
from typing import (
    TYPE_CHECKING,
    Any,
    Literal,
    TypeVar,
    cast,
)

from attrs import define as _attrs_define

from ..models.dashboard_tile_variant_1_unit import (
    DashboardTileVariant1Unit,
    check_dashboard_tile_variant_1_unit,
)
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.dashboard_chart import DashboardChart
    from ..models.dashboard_tile_variant_1_layout import DashboardTileVariant1Layout


T = TypeVar("T", bound="DashboardTileVariant1")


@_attrs_define
class DashboardTileVariant1:
    """
    Attributes:
        id (str):
        title (str):
        layout (DashboardTileVariant1Layout):
        type_ (Literal['chart']):
        sql (str):
        chart (DashboardChart):
        description (str | Unset):
        series_by (str | Unset):
        unit (DashboardTileVariant1Unit | Unset):
    """

    id: str
    title: str
    layout: DashboardTileVariant1Layout
    type_: Literal["chart"]
    sql: str
    chart: DashboardChart
    description: str | Unset = UNSET
    series_by: str | Unset = UNSET
    unit: DashboardTileVariant1Unit | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        title = self.title

        layout = self.layout.to_dict()

        type_ = self.type_

        sql = self.sql

        chart = self.chart.to_dict()

        description = self.description

        series_by = self.series_by

        unit: str | Unset = UNSET
        if not isinstance(self.unit, Unset):
            unit = self.unit

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "title": title,
                "layout": layout,
                "type": type_,
                "sql": sql,
                "chart": chart,
            }
        )
        if description is not UNSET:
            field_dict["description"] = description
        if series_by is not UNSET:
            field_dict["series_by"] = series_by
        if unit is not UNSET:
            field_dict["unit"] = unit

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.dashboard_chart import DashboardChart  # noqa: PLC0415
        from ..models.dashboard_tile_variant_1_layout import (
            DashboardTileVariant1Layout,  # noqa: PLC0415
        )

        d = dict(src_dict)
        id = d.pop("id")

        title = d.pop("title")

        layout = DashboardTileVariant1Layout.from_dict(d.pop("layout"))

        type_ = cast(Literal["chart"], d.pop("type"))
        if type_ != "chart":
            raise ValueError(f"type must match const 'chart', got '{type_}'")

        sql = d.pop("sql")

        chart = DashboardChart.from_dict(d.pop("chart"))

        description = d.pop("description", UNSET)

        series_by = d.pop("series_by", UNSET)

        _unit = d.pop("unit", UNSET)
        unit: DashboardTileVariant1Unit | Unset
        if isinstance(_unit, Unset):
            unit = UNSET
        else:
            unit = check_dashboard_tile_variant_1_unit(_unit)

        dashboard_tile_variant_1 = cls(
            id=id,
            title=title,
            layout=layout,
            type_=type_,
            sql=sql,
            chart=chart,
            description=description,
            series_by=series_by,
            unit=unit,
        )

        return dashboard_tile_variant_1
