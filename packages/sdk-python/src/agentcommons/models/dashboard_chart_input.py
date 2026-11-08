from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.dashboard_chart_input_angle_axis import DashboardChartInputAngleAxis
    from ..models.dashboard_chart_input_data_zoom_item import (
        DashboardChartInputDataZoomItem,
    )
    from ..models.dashboard_chart_input_grid import DashboardChartInputGrid
    from ..models.dashboard_chart_input_legend import DashboardChartInputLegend
    from ..models.dashboard_chart_input_polar import DashboardChartInputPolar
    from ..models.dashboard_chart_input_radius_axis import DashboardChartInputRadiusAxis
    from ..models.dashboard_chart_input_series_item import DashboardChartInputSeriesItem
    from ..models.dashboard_chart_input_tooltip import DashboardChartInputTooltip
    from ..models.dashboard_chart_input_visual_map_type_0 import (
        DashboardChartInputVisualMapType0,
    )
    from ..models.dashboard_chart_input_visual_map_type_1_item import (
        DashboardChartInputVisualMapType1Item,
    )
    from ..models.dashboard_chart_input_x_axis_type_0 import (
        DashboardChartInputXAxisType0,
    )
    from ..models.dashboard_chart_input_x_axis_type_1_item import (
        DashboardChartInputXAxisType1Item,
    )
    from ..models.dashboard_chart_input_y_axis_type_0 import (
        DashboardChartInputYAxisType0,
    )
    from ..models.dashboard_chart_input_y_axis_type_1_item import (
        DashboardChartInputYAxisType1Item,
    )


T = TypeVar("T", bound="DashboardChartInput")


@_attrs_define
class DashboardChartInput:
    """
    Attributes:
        series (list[DashboardChartInputSeriesItem]):
        x_axis (DashboardChartInputXAxisType0 | list[DashboardChartInputXAxisType1Item] | Unset):
        y_axis (DashboardChartInputYAxisType0 | list[DashboardChartInputYAxisType1Item] | Unset):
        legend (DashboardChartInputLegend | Unset):
        tooltip (DashboardChartInputTooltip | Unset):
        grid (DashboardChartInputGrid | Unset):
        color (list[str] | Unset):
        data_zoom (list[DashboardChartInputDataZoomItem] | Unset):
        visual_map (DashboardChartInputVisualMapType0 | list[DashboardChartInputVisualMapType1Item] | Unset):
        polar (DashboardChartInputPolar | Unset):
        radius_axis (DashboardChartInputRadiusAxis | Unset):
        angle_axis (DashboardChartInputAngleAxis | Unset):
    """

    series: list[DashboardChartInputSeriesItem]
    x_axis: (
        DashboardChartInputXAxisType0 | list[DashboardChartInputXAxisType1Item] | Unset
    ) = UNSET
    y_axis: (
        DashboardChartInputYAxisType0 | list[DashboardChartInputYAxisType1Item] | Unset
    ) = UNSET
    legend: DashboardChartInputLegend | Unset = UNSET
    tooltip: DashboardChartInputTooltip | Unset = UNSET
    grid: DashboardChartInputGrid | Unset = UNSET
    color: list[str] | Unset = UNSET
    data_zoom: list[DashboardChartInputDataZoomItem] | Unset = UNSET
    visual_map: (
        DashboardChartInputVisualMapType0
        | list[DashboardChartInputVisualMapType1Item]
        | Unset
    ) = UNSET
    polar: DashboardChartInputPolar | Unset = UNSET
    radius_axis: DashboardChartInputRadiusAxis | Unset = UNSET
    angle_axis: DashboardChartInputAngleAxis | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        from ..models.dashboard_chart_input_visual_map_type_0 import (
            DashboardChartInputVisualMapType0,  # noqa: PLC0415
        )
        from ..models.dashboard_chart_input_x_axis_type_0 import (
            DashboardChartInputXAxisType0,  # noqa: PLC0415
        )
        from ..models.dashboard_chart_input_y_axis_type_0 import (
            DashboardChartInputYAxisType0,  # noqa: PLC0415
        )

        series = []
        for series_item_data in self.series:
            series_item = series_item_data.to_dict()
            series.append(series_item)

        x_axis: dict[str, Any] | list[dict[str, Any]] | Unset
        if isinstance(self.x_axis, Unset):
            x_axis = UNSET
        elif isinstance(self.x_axis, DashboardChartInputXAxisType0):
            x_axis = self.x_axis.to_dict()
        else:
            x_axis = []
            for x_axis_type_1_item_data in self.x_axis:
                x_axis_type_1_item = x_axis_type_1_item_data.to_dict()
                x_axis.append(x_axis_type_1_item)

        y_axis: dict[str, Any] | list[dict[str, Any]] | Unset
        if isinstance(self.y_axis, Unset):
            y_axis = UNSET
        elif isinstance(self.y_axis, DashboardChartInputYAxisType0):
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
        elif isinstance(self.visual_map, DashboardChartInputVisualMapType0):
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
        from ..models.dashboard_chart_input_angle_axis import (
            DashboardChartInputAngleAxis,  # noqa: PLC0415
        )
        from ..models.dashboard_chart_input_data_zoom_item import (
            DashboardChartInputDataZoomItem,  # noqa: PLC0415
        )
        from ..models.dashboard_chart_input_grid import (
            DashboardChartInputGrid,  # noqa: PLC0415
        )
        from ..models.dashboard_chart_input_legend import (
            DashboardChartInputLegend,  # noqa: PLC0415
        )
        from ..models.dashboard_chart_input_polar import (
            DashboardChartInputPolar,  # noqa: PLC0415
        )
        from ..models.dashboard_chart_input_radius_axis import (
            DashboardChartInputRadiusAxis,  # noqa: PLC0415
        )
        from ..models.dashboard_chart_input_series_item import (
            DashboardChartInputSeriesItem,  # noqa: PLC0415
        )
        from ..models.dashboard_chart_input_tooltip import (
            DashboardChartInputTooltip,  # noqa: PLC0415
        )
        from ..models.dashboard_chart_input_visual_map_type_0 import (
            DashboardChartInputVisualMapType0,  # noqa: PLC0415
        )
        from ..models.dashboard_chart_input_visual_map_type_1_item import (
            DashboardChartInputVisualMapType1Item,  # noqa: PLC0415
        )
        from ..models.dashboard_chart_input_x_axis_type_0 import (
            DashboardChartInputXAxisType0,  # noqa: PLC0415
        )
        from ..models.dashboard_chart_input_x_axis_type_1_item import (
            DashboardChartInputXAxisType1Item,  # noqa: PLC0415
        )
        from ..models.dashboard_chart_input_y_axis_type_0 import (
            DashboardChartInputYAxisType0,  # noqa: PLC0415
        )
        from ..models.dashboard_chart_input_y_axis_type_1_item import (
            DashboardChartInputYAxisType1Item,  # noqa: PLC0415
        )

        d = dict(src_dict)
        series = []
        _series = d.pop("series")
        for series_item_data in _series:
            series_item = DashboardChartInputSeriesItem.from_dict(series_item_data)

            series.append(series_item)

        def _parse_x_axis(
            data: object,
        ) -> (
            DashboardChartInputXAxisType0
            | list[DashboardChartInputXAxisType1Item]
            | Unset
        ):
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                x_axis_type_0 = DashboardChartInputXAxisType0.from_dict(data)

                return x_axis_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, list):
                raise TypeError()
            x_axis_type_1 = []
            _x_axis_type_1 = data
            for x_axis_type_1_item_data in _x_axis_type_1:
                x_axis_type_1_item = DashboardChartInputXAxisType1Item.from_dict(
                    x_axis_type_1_item_data
                )

                x_axis_type_1.append(x_axis_type_1_item)

            return x_axis_type_1

        x_axis = _parse_x_axis(d.pop("xAxis", UNSET))

        def _parse_y_axis(
            data: object,
        ) -> (
            DashboardChartInputYAxisType0
            | list[DashboardChartInputYAxisType1Item]
            | Unset
        ):
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                y_axis_type_0 = DashboardChartInputYAxisType0.from_dict(data)

                return y_axis_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, list):
                raise TypeError()
            y_axis_type_1 = []
            _y_axis_type_1 = data
            for y_axis_type_1_item_data in _y_axis_type_1:
                y_axis_type_1_item = DashboardChartInputYAxisType1Item.from_dict(
                    y_axis_type_1_item_data
                )

                y_axis_type_1.append(y_axis_type_1_item)

            return y_axis_type_1

        y_axis = _parse_y_axis(d.pop("yAxis", UNSET))

        _legend = d.pop("legend", UNSET)
        legend: DashboardChartInputLegend | Unset
        if isinstance(_legend, Unset):
            legend = UNSET
        else:
            legend = DashboardChartInputLegend.from_dict(_legend)

        _tooltip = d.pop("tooltip", UNSET)
        tooltip: DashboardChartInputTooltip | Unset
        if isinstance(_tooltip, Unset):
            tooltip = UNSET
        else:
            tooltip = DashboardChartInputTooltip.from_dict(_tooltip)

        _grid = d.pop("grid", UNSET)
        grid: DashboardChartInputGrid | Unset
        if isinstance(_grid, Unset):
            grid = UNSET
        else:
            grid = DashboardChartInputGrid.from_dict(_grid)

        color = cast(list[str], d.pop("color", UNSET))

        _data_zoom = d.pop("dataZoom", UNSET)
        data_zoom: list[DashboardChartInputDataZoomItem] | Unset = UNSET
        if _data_zoom is not UNSET:
            data_zoom = []
            for data_zoom_item_data in _data_zoom:
                data_zoom_item = DashboardChartInputDataZoomItem.from_dict(
                    data_zoom_item_data
                )

                data_zoom.append(data_zoom_item)

        def _parse_visual_map(
            data: object,
        ) -> (
            DashboardChartInputVisualMapType0
            | list[DashboardChartInputVisualMapType1Item]
            | Unset
        ):
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                visual_map_type_0 = DashboardChartInputVisualMapType0.from_dict(data)

                return visual_map_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, list):
                raise TypeError()
            visual_map_type_1 = []
            _visual_map_type_1 = data
            for visual_map_type_1_item_data in _visual_map_type_1:
                visual_map_type_1_item = (
                    DashboardChartInputVisualMapType1Item.from_dict(
                        visual_map_type_1_item_data
                    )
                )

                visual_map_type_1.append(visual_map_type_1_item)

            return visual_map_type_1

        visual_map = _parse_visual_map(d.pop("visualMap", UNSET))

        _polar = d.pop("polar", UNSET)
        polar: DashboardChartInputPolar | Unset
        if isinstance(_polar, Unset):
            polar = UNSET
        else:
            polar = DashboardChartInputPolar.from_dict(_polar)

        _radius_axis = d.pop("radiusAxis", UNSET)
        radius_axis: DashboardChartInputRadiusAxis | Unset
        if isinstance(_radius_axis, Unset):
            radius_axis = UNSET
        else:
            radius_axis = DashboardChartInputRadiusAxis.from_dict(_radius_axis)

        _angle_axis = d.pop("angleAxis", UNSET)
        angle_axis: DashboardChartInputAngleAxis | Unset
        if isinstance(_angle_axis, Unset):
            angle_axis = UNSET
        else:
            angle_axis = DashboardChartInputAngleAxis.from_dict(_angle_axis)

        dashboard_chart_input = cls(
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

        return dashboard_chart_input
