from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.dashboard_chart_angle_axis import DashboardChartAngleAxis
    from ..models.dashboard_chart_data_zoom_item import DashboardChartDataZoomItem
    from ..models.dashboard_chart_grid import DashboardChartGrid
    from ..models.dashboard_chart_legend import DashboardChartLegend
    from ..models.dashboard_chart_polar import DashboardChartPolar
    from ..models.dashboard_chart_radius_axis import DashboardChartRadiusAxis
    from ..models.dashboard_chart_series_item import DashboardChartSeriesItem
    from ..models.dashboard_chart_tooltip import DashboardChartTooltip
    from ..models.dashboard_chart_visual_map_type_0 import DashboardChartVisualMapType0
    from ..models.dashboard_chart_visual_map_type_1_item import (
        DashboardChartVisualMapType1Item,
    )
    from ..models.dashboard_chart_x_axis_type_0 import DashboardChartXAxisType0
    from ..models.dashboard_chart_x_axis_type_1_item import DashboardChartXAxisType1Item
    from ..models.dashboard_chart_y_axis_type_0 import DashboardChartYAxisType0
    from ..models.dashboard_chart_y_axis_type_1_item import DashboardChartYAxisType1Item


T = TypeVar("T", bound="DashboardChart")


@_attrs_define
class DashboardChart:
    """
    Attributes:
        series (list[DashboardChartSeriesItem]):
        x_axis (DashboardChartXAxisType0 | list[DashboardChartXAxisType1Item] | Unset):
        y_axis (DashboardChartYAxisType0 | list[DashboardChartYAxisType1Item] | Unset):
        legend (DashboardChartLegend | Unset):
        tooltip (DashboardChartTooltip | Unset):
        grid (DashboardChartGrid | Unset):
        color (list[str] | Unset):
        data_zoom (list[DashboardChartDataZoomItem] | Unset):
        visual_map (DashboardChartVisualMapType0 | list[DashboardChartVisualMapType1Item] | Unset):
        polar (DashboardChartPolar | Unset):
        radius_axis (DashboardChartRadiusAxis | Unset):
        angle_axis (DashboardChartAngleAxis | Unset):
    """

    series: list[DashboardChartSeriesItem]
    x_axis: DashboardChartXAxisType0 | list[DashboardChartXAxisType1Item] | Unset = (
        UNSET
    )
    y_axis: DashboardChartYAxisType0 | list[DashboardChartYAxisType1Item] | Unset = (
        UNSET
    )
    legend: DashboardChartLegend | Unset = UNSET
    tooltip: DashboardChartTooltip | Unset = UNSET
    grid: DashboardChartGrid | Unset = UNSET
    color: list[str] | Unset = UNSET
    data_zoom: list[DashboardChartDataZoomItem] | Unset = UNSET
    visual_map: (
        DashboardChartVisualMapType0 | list[DashboardChartVisualMapType1Item] | Unset
    ) = UNSET
    polar: DashboardChartPolar | Unset = UNSET
    radius_axis: DashboardChartRadiusAxis | Unset = UNSET
    angle_axis: DashboardChartAngleAxis | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        from ..models.dashboard_chart_visual_map_type_0 import (
            DashboardChartVisualMapType0,  # noqa: PLC0415
        )
        from ..models.dashboard_chart_x_axis_type_0 import (
            DashboardChartXAxisType0,  # noqa: PLC0415
        )
        from ..models.dashboard_chart_y_axis_type_0 import (
            DashboardChartYAxisType0,  # noqa: PLC0415
        )

        series = []
        for series_item_data in self.series:
            series_item = series_item_data.to_dict()
            series.append(series_item)

        x_axis: dict[str, Any] | list[dict[str, Any]] | Unset
        if isinstance(self.x_axis, Unset):
            x_axis = UNSET
        elif isinstance(self.x_axis, DashboardChartXAxisType0):
            x_axis = self.x_axis.to_dict()
        else:
            x_axis = []
            for x_axis_type_1_item_data in self.x_axis:
                x_axis_type_1_item = x_axis_type_1_item_data.to_dict()
                x_axis.append(x_axis_type_1_item)

        y_axis: dict[str, Any] | list[dict[str, Any]] | Unset
        if isinstance(self.y_axis, Unset):
            y_axis = UNSET
        elif isinstance(self.y_axis, DashboardChartYAxisType0):
            y_axis = self.y_axis.to_dict()
        else:
            y_axis = []
            for y_axis_type_1_item_data in self.y_axis:
                y_axis_type_1_item = y_axis_type_1_item_data.to_dict()
                y_axis.append(y_axis_type_1_item)

        legend: dict[str, Any] | Unset = UNSET
        if not isinstance(self.legend, Unset):
            legend = self.legend.to_dict()

        tooltip: dict[str, Any] | Unset = UNSET
        if not isinstance(self.tooltip, Unset):
            tooltip = self.tooltip.to_dict()

        grid: dict[str, Any] | Unset = UNSET
        if not isinstance(self.grid, Unset):
            grid = self.grid.to_dict()

        color: list[str] | Unset = UNSET
        if not isinstance(self.color, Unset):
            color = self.color

        data_zoom: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.data_zoom, Unset):
            data_zoom = []
            for data_zoom_item_data in self.data_zoom:
                data_zoom_item = data_zoom_item_data.to_dict()
                data_zoom.append(data_zoom_item)

        visual_map: dict[str, Any] | list[dict[str, Any]] | Unset
        if isinstance(self.visual_map, Unset):
            visual_map = UNSET
        elif isinstance(self.visual_map, DashboardChartVisualMapType0):
            visual_map = self.visual_map.to_dict()
        else:
            visual_map = []
            for visual_map_type_1_item_data in self.visual_map:
                visual_map_type_1_item = visual_map_type_1_item_data.to_dict()
                visual_map.append(visual_map_type_1_item)

        polar: dict[str, Any] | Unset = UNSET
        if not isinstance(self.polar, Unset):
            polar = self.polar.to_dict()

        radius_axis: dict[str, Any] | Unset = UNSET
        if not isinstance(self.radius_axis, Unset):
            radius_axis = self.radius_axis.to_dict()

        angle_axis: dict[str, Any] | Unset = UNSET
        if not isinstance(self.angle_axis, Unset):
            angle_axis = self.angle_axis.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "series": series,
            }
        )
        if x_axis is not UNSET:
            field_dict["xAxis"] = x_axis
        if y_axis is not UNSET:
            field_dict["yAxis"] = y_axis
        if legend is not UNSET:
            field_dict["legend"] = legend
        if tooltip is not UNSET:
            field_dict["tooltip"] = tooltip
        if grid is not UNSET:
            field_dict["grid"] = grid
        if color is not UNSET:
            field_dict["color"] = color
        if data_zoom is not UNSET:
            field_dict["dataZoom"] = data_zoom
        if visual_map is not UNSET:
            field_dict["visualMap"] = visual_map
        if polar is not UNSET:
            field_dict["polar"] = polar
        if radius_axis is not UNSET:
            field_dict["radiusAxis"] = radius_axis
        if angle_axis is not UNSET:
            field_dict["angleAxis"] = angle_axis

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.dashboard_chart_angle_axis import (
            DashboardChartAngleAxis,  # noqa: PLC0415
        )
        from ..models.dashboard_chart_data_zoom_item import (
            DashboardChartDataZoomItem,  # noqa: PLC0415
        )
        from ..models.dashboard_chart_grid import DashboardChartGrid  # noqa: PLC0415
        from ..models.dashboard_chart_legend import (
            DashboardChartLegend,  # noqa: PLC0415
        )
        from ..models.dashboard_chart_polar import DashboardChartPolar  # noqa: PLC0415
        from ..models.dashboard_chart_radius_axis import (
            DashboardChartRadiusAxis,  # noqa: PLC0415
        )
        from ..models.dashboard_chart_series_item import (
            DashboardChartSeriesItem,  # noqa: PLC0415
        )
        from ..models.dashboard_chart_tooltip import (
            DashboardChartTooltip,  # noqa: PLC0415
        )
        from ..models.dashboard_chart_visual_map_type_0 import (
            DashboardChartVisualMapType0,  # noqa: PLC0415
        )
        from ..models.dashboard_chart_visual_map_type_1_item import (
            DashboardChartVisualMapType1Item,  # noqa: PLC0415
        )
        from ..models.dashboard_chart_x_axis_type_0 import (
            DashboardChartXAxisType0,  # noqa: PLC0415
        )
        from ..models.dashboard_chart_x_axis_type_1_item import (
            DashboardChartXAxisType1Item,  # noqa: PLC0415
        )
        from ..models.dashboard_chart_y_axis_type_0 import (
            DashboardChartYAxisType0,  # noqa: PLC0415
        )
        from ..models.dashboard_chart_y_axis_type_1_item import (
            DashboardChartYAxisType1Item,  # noqa: PLC0415
        )

        d = dict(src_dict)
        series = []
        _series = d.pop("series")
        for series_item_data in _series:
            series_item = DashboardChartSeriesItem.from_dict(series_item_data)

            series.append(series_item)

        def _parse_x_axis(
            data: object,
        ) -> DashboardChartXAxisType0 | list[DashboardChartXAxisType1Item] | Unset:
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                x_axis_type_0 = DashboardChartXAxisType0.from_dict(data)

                return x_axis_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, list):
                raise TypeError()
            x_axis_type_1 = []
            _x_axis_type_1 = data
            for x_axis_type_1_item_data in _x_axis_type_1:
                x_axis_type_1_item = DashboardChartXAxisType1Item.from_dict(
                    x_axis_type_1_item_data
                )

                x_axis_type_1.append(x_axis_type_1_item)

            return x_axis_type_1

        x_axis = _parse_x_axis(d.pop("xAxis", UNSET))

        def _parse_y_axis(
            data: object,
        ) -> DashboardChartYAxisType0 | list[DashboardChartYAxisType1Item] | Unset:
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                y_axis_type_0 = DashboardChartYAxisType0.from_dict(data)

                return y_axis_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, list):
                raise TypeError()
            y_axis_type_1 = []
            _y_axis_type_1 = data
            for y_axis_type_1_item_data in _y_axis_type_1:
                y_axis_type_1_item = DashboardChartYAxisType1Item.from_dict(
                    y_axis_type_1_item_data
                )

                y_axis_type_1.append(y_axis_type_1_item)

            return y_axis_type_1

        y_axis = _parse_y_axis(d.pop("yAxis", UNSET))

        _legend = d.pop("legend", UNSET)
        legend: DashboardChartLegend | Unset
        if isinstance(_legend, Unset):
            legend = UNSET
        else:
            legend = DashboardChartLegend.from_dict(_legend)

        _tooltip = d.pop("tooltip", UNSET)
        tooltip: DashboardChartTooltip | Unset
        if isinstance(_tooltip, Unset):
            tooltip = UNSET
        else:
            tooltip = DashboardChartTooltip.from_dict(_tooltip)

        _grid = d.pop("grid", UNSET)
        grid: DashboardChartGrid | Unset
        if isinstance(_grid, Unset):
            grid = UNSET
        else:
            grid = DashboardChartGrid.from_dict(_grid)

        color = cast(list[str], d.pop("color", UNSET))

        _data_zoom = d.pop("dataZoom", UNSET)
        data_zoom: list[DashboardChartDataZoomItem] | Unset = UNSET
        if _data_zoom is not UNSET:
            data_zoom = []
            for data_zoom_item_data in _data_zoom:
                data_zoom_item = DashboardChartDataZoomItem.from_dict(
                    data_zoom_item_data
                )

                data_zoom.append(data_zoom_item)

        def _parse_visual_map(
            data: object,
        ) -> (
            DashboardChartVisualMapType0
            | list[DashboardChartVisualMapType1Item]
            | Unset
        ):
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                visual_map_type_0 = DashboardChartVisualMapType0.from_dict(data)

                return visual_map_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, list):
                raise TypeError()
            visual_map_type_1 = []
            _visual_map_type_1 = data
            for visual_map_type_1_item_data in _visual_map_type_1:
                visual_map_type_1_item = DashboardChartVisualMapType1Item.from_dict(
                    visual_map_type_1_item_data
                )

                visual_map_type_1.append(visual_map_type_1_item)

            return visual_map_type_1

        visual_map = _parse_visual_map(d.pop("visualMap", UNSET))

        _polar = d.pop("polar", UNSET)
        polar: DashboardChartPolar | Unset
        if isinstance(_polar, Unset):
            polar = UNSET
        else:
            polar = DashboardChartPolar.from_dict(_polar)

        _radius_axis = d.pop("radiusAxis", UNSET)
        radius_axis: DashboardChartRadiusAxis | Unset
        if isinstance(_radius_axis, Unset):
            radius_axis = UNSET
        else:
            radius_axis = DashboardChartRadiusAxis.from_dict(_radius_axis)

        _angle_axis = d.pop("angleAxis", UNSET)
        angle_axis: DashboardChartAngleAxis | Unset
        if isinstance(_angle_axis, Unset):
            angle_axis = UNSET
        else:
            angle_axis = DashboardChartAngleAxis.from_dict(_angle_axis)

        dashboard_chart = cls(
            series=series,
            x_axis=x_axis,
            y_axis=y_axis,
            legend=legend,
            tooltip=tooltip,
            grid=grid,
            color=color,
            data_zoom=data_zoom,
            visual_map=visual_map,
            polar=polar,
            radius_axis=radius_axis,
            angle_axis=angle_axis,
        )

        return dashboard_chart
