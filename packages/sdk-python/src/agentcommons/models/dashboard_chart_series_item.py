from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.dashboard_chart_series_item_rose_type_type_1 import (
    DashboardChartSeriesItemRoseTypeType1,
    check_dashboard_chart_series_item_rose_type_type_1,
)
from ..models.dashboard_chart_series_item_step_type_1 import (
    DashboardChartSeriesItemStepType1,
    check_dashboard_chart_series_item_step_type_1,
)
from ..models.dashboard_chart_series_item_type import (
    DashboardChartSeriesItemType,
    check_dashboard_chart_series_item_type,
)
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.dashboard_chart_series_item_area_style import (
        DashboardChartSeriesItemAreaStyle,
    )
    from ..models.dashboard_chart_series_item_axis_label import (
        DashboardChartSeriesItemAxisLabel,
    )
    from ..models.dashboard_chart_series_item_axis_line import (
        DashboardChartSeriesItemAxisLine,
    )
    from ..models.dashboard_chart_series_item_axis_tick import (
        DashboardChartSeriesItemAxisTick,
    )
    from ..models.dashboard_chart_series_item_detail import (
        DashboardChartSeriesItemDetail,
    )
    from ..models.dashboard_chart_series_item_emphasis import (
        DashboardChartSeriesItemEmphasis,
    )
    from ..models.dashboard_chart_series_item_encode import (
        DashboardChartSeriesItemEncode,
    )
    from ..models.dashboard_chart_series_item_item_style import (
        DashboardChartSeriesItemItemStyle,
    )
    from ..models.dashboard_chart_series_item_label import DashboardChartSeriesItemLabel
    from ..models.dashboard_chart_series_item_label_line import (
        DashboardChartSeriesItemLabelLine,
    )
    from ..models.dashboard_chart_series_item_line_style import (
        DashboardChartSeriesItemLineStyle,
    )
    from ..models.dashboard_chart_series_item_pointer import (
        DashboardChartSeriesItemPointer,
    )
    from ..models.dashboard_chart_series_item_progress import (
        DashboardChartSeriesItemProgress,
    )
    from ..models.dashboard_chart_series_item_split_line import (
        DashboardChartSeriesItemSplitLine,
    )
    from ..models.dashboard_chart_series_item_title import DashboardChartSeriesItemTitle


T = TypeVar("T", bound="DashboardChartSeriesItem")


@_attrs_define
class DashboardChartSeriesItem:
    """
    Attributes:
        type_ (DashboardChartSeriesItemType):
        name (str | Unset):
        encode (DashboardChartSeriesItemEncode | Unset):
        stack (str | Unset):
        smooth (bool | Unset):
        step (bool | DashboardChartSeriesItemStepType1 | Unset):
        show_symbol (bool | Unset):
        symbol (str | Unset):
        symbol_size (float | Unset):
        connect_nulls (bool | Unset):
        area_style (DashboardChartSeriesItemAreaStyle | Unset):
        line_style (DashboardChartSeriesItemLineStyle | Unset):
        item_style (DashboardChartSeriesItemItemStyle | Unset):
        label (DashboardChartSeriesItemLabel | Unset):
        label_line (DashboardChartSeriesItemLabelLine | Unset):
        emphasis (DashboardChartSeriesItemEmphasis | Unset):
        bar_width (float | str | Unset):
        bar_max_width (float | str | Unset):
        bar_gap (str | Unset):
        radius (float | list[float | str] | str | Unset):
        center (list[float | str] | Unset):
        rose_type (bool | DashboardChartSeriesItemRoseTypeType1 | Unset):
        x_axis_index (int | Unset):
        y_axis_index (int | Unset):
        min_ (float | Unset):
        max_ (float | Unset):
        progress (DashboardChartSeriesItemProgress | Unset):
        detail (DashboardChartSeriesItemDetail | Unset):
        axis_line (DashboardChartSeriesItemAxisLine | Unset):
        pointer (DashboardChartSeriesItemPointer | Unset):
        split_line (DashboardChartSeriesItemSplitLine | Unset):
        axis_label (DashboardChartSeriesItemAxisLabel | Unset):
        axis_tick (DashboardChartSeriesItemAxisTick | Unset):
        title (DashboardChartSeriesItemTitle | Unset):
    """

    type_: DashboardChartSeriesItemType
    name: str | Unset = UNSET
    encode: DashboardChartSeriesItemEncode | Unset = UNSET
    stack: str | Unset = UNSET
    smooth: bool | Unset = UNSET
    step: bool | DashboardChartSeriesItemStepType1 | Unset = UNSET
    show_symbol: bool | Unset = UNSET
    symbol: str | Unset = UNSET
    symbol_size: float | Unset = UNSET
    connect_nulls: bool | Unset = UNSET
    area_style: DashboardChartSeriesItemAreaStyle | Unset = UNSET
    line_style: DashboardChartSeriesItemLineStyle | Unset = UNSET
    item_style: DashboardChartSeriesItemItemStyle | Unset = UNSET
    label: DashboardChartSeriesItemLabel | Unset = UNSET
    label_line: DashboardChartSeriesItemLabelLine | Unset = UNSET
    emphasis: DashboardChartSeriesItemEmphasis | Unset = UNSET
    bar_width: float | str | Unset = UNSET
    bar_max_width: float | str | Unset = UNSET
    bar_gap: str | Unset = UNSET
    radius: float | list[float | str] | str | Unset = UNSET
    center: list[float | str] | Unset = UNSET
    rose_type: bool | DashboardChartSeriesItemRoseTypeType1 | Unset = UNSET
    x_axis_index: int | Unset = UNSET
    y_axis_index: int | Unset = UNSET
    min_: float | Unset = UNSET
    max_: float | Unset = UNSET
    progress: DashboardChartSeriesItemProgress | Unset = UNSET
    detail: DashboardChartSeriesItemDetail | Unset = UNSET
    axis_line: DashboardChartSeriesItemAxisLine | Unset = UNSET
    pointer: DashboardChartSeriesItemPointer | Unset = UNSET
    split_line: DashboardChartSeriesItemSplitLine | Unset = UNSET
    axis_label: DashboardChartSeriesItemAxisLabel | Unset = UNSET
    axis_tick: DashboardChartSeriesItemAxisTick | Unset = UNSET
    title: DashboardChartSeriesItemTitle | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        type_: str = self.type_

        name = self.name

        encode: dict[str, Any] | Unset = UNSET
        if not isinstance(self.encode, Unset):
            encode = self.encode.to_dict()

        stack = self.stack

        smooth = self.smooth

        step: bool | str | Unset
        if isinstance(self.step, Unset):
            step = UNSET
        elif isinstance(self.step, str):
            step = self.step
        else:
            step = self.step

        show_symbol = self.show_symbol

        symbol = self.symbol

        symbol_size = self.symbol_size

        connect_nulls = self.connect_nulls

        area_style: dict[str, Any] | Unset = UNSET
        if not isinstance(self.area_style, Unset):
            area_style = self.area_style.to_dict()

        line_style: dict[str, Any] | Unset = UNSET
        if not isinstance(self.line_style, Unset):
            line_style = self.line_style.to_dict()

        item_style: dict[str, Any] | Unset = UNSET
        if not isinstance(self.item_style, Unset):
            item_style = self.item_style.to_dict()

        label: dict[str, Any] | Unset = UNSET
        if not isinstance(self.label, Unset):
            label = self.label.to_dict()

        label_line: dict[str, Any] | Unset = UNSET
        if not isinstance(self.label_line, Unset):
            label_line = self.label_line.to_dict()

        emphasis: dict[str, Any] | Unset = UNSET
        if not isinstance(self.emphasis, Unset):
            emphasis = self.emphasis.to_dict()

        bar_width: float | str | Unset
        if isinstance(self.bar_width, Unset):
            bar_width = UNSET
        else:
            bar_width = self.bar_width

        bar_max_width: float | str | Unset
        if isinstance(self.bar_max_width, Unset):
            bar_max_width = UNSET
        else:
            bar_max_width = self.bar_max_width

        bar_gap = self.bar_gap

        radius: float | list[float | str] | str | Unset
        if isinstance(self.radius, Unset):
            radius = UNSET
        elif isinstance(self.radius, list):
            radius = []
            for radius_type_1_item_data in self.radius:
                radius_type_1_item: float | str
                radius_type_1_item = radius_type_1_item_data
                radius.append(radius_type_1_item)

        else:
            radius = self.radius

        center: list[float | str] | Unset = UNSET
        if not isinstance(self.center, Unset):
            center = []
            for center_item_data in self.center:
                center_item: float | str
                center_item = center_item_data
                center.append(center_item)

        rose_type: bool | str | Unset
        if isinstance(self.rose_type, Unset):
            rose_type = UNSET
        elif isinstance(self.rose_type, str):
            rose_type = self.rose_type
        else:
            rose_type = self.rose_type

        x_axis_index = self.x_axis_index

        y_axis_index = self.y_axis_index

        min_ = self.min_

        max_ = self.max_

        progress: dict[str, Any] | Unset = UNSET
        if not isinstance(self.progress, Unset):
            progress = self.progress.to_dict()

        detail: dict[str, Any] | Unset = UNSET
        if not isinstance(self.detail, Unset):
            detail = self.detail.to_dict()

        axis_line: dict[str, Any] | Unset = UNSET
        if not isinstance(self.axis_line, Unset):
            axis_line = self.axis_line.to_dict()

        pointer: dict[str, Any] | Unset = UNSET
        if not isinstance(self.pointer, Unset):
            pointer = self.pointer.to_dict()

        split_line: dict[str, Any] | Unset = UNSET
        if not isinstance(self.split_line, Unset):
            split_line = self.split_line.to_dict()

        axis_label: dict[str, Any] | Unset = UNSET
        if not isinstance(self.axis_label, Unset):
            axis_label = self.axis_label.to_dict()

        axis_tick: dict[str, Any] | Unset = UNSET
        if not isinstance(self.axis_tick, Unset):
            axis_tick = self.axis_tick.to_dict()

        title: dict[str, Any] | Unset = UNSET
        if not isinstance(self.title, Unset):
            title = self.title.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "type": type_,
            }
        )
        if name is not UNSET:
            field_dict["name"] = name
        if encode is not UNSET:
            field_dict["encode"] = encode
        if stack is not UNSET:
            field_dict["stack"] = stack
        if smooth is not UNSET:
            field_dict["smooth"] = smooth
        if step is not UNSET:
            field_dict["step"] = step
        if show_symbol is not UNSET:
            field_dict["showSymbol"] = show_symbol
        if symbol is not UNSET:
            field_dict["symbol"] = symbol
        if symbol_size is not UNSET:
            field_dict["symbolSize"] = symbol_size
        if connect_nulls is not UNSET:
            field_dict["connectNulls"] = connect_nulls
        if area_style is not UNSET:
            field_dict["areaStyle"] = area_style
        if line_style is not UNSET:
            field_dict["lineStyle"] = line_style
        if item_style is not UNSET:
            field_dict["itemStyle"] = item_style
        if label is not UNSET:
            field_dict["label"] = label
        if label_line is not UNSET:
            field_dict["labelLine"] = label_line
        if emphasis is not UNSET:
            field_dict["emphasis"] = emphasis
        if bar_width is not UNSET:
            field_dict["barWidth"] = bar_width
        if bar_max_width is not UNSET:
            field_dict["barMaxWidth"] = bar_max_width
        if bar_gap is not UNSET:
            field_dict["barGap"] = bar_gap
        if radius is not UNSET:
            field_dict["radius"] = radius
        if center is not UNSET:
            field_dict["center"] = center
        if rose_type is not UNSET:
            field_dict["roseType"] = rose_type
        if x_axis_index is not UNSET:
            field_dict["xAxisIndex"] = x_axis_index
        if y_axis_index is not UNSET:
            field_dict["yAxisIndex"] = y_axis_index
        if min_ is not UNSET:
            field_dict["min"] = min_
        if max_ is not UNSET:
            field_dict["max"] = max_
        if progress is not UNSET:
            field_dict["progress"] = progress
        if detail is not UNSET:
            field_dict["detail"] = detail
        if axis_line is not UNSET:
            field_dict["axisLine"] = axis_line
        if pointer is not UNSET:
            field_dict["pointer"] = pointer
        if split_line is not UNSET:
            field_dict["splitLine"] = split_line
        if axis_label is not UNSET:
            field_dict["axisLabel"] = axis_label
        if axis_tick is not UNSET:
            field_dict["axisTick"] = axis_tick
        if title is not UNSET:
            field_dict["title"] = title

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.dashboard_chart_series_item_area_style import (
            DashboardChartSeriesItemAreaStyle,  # noqa: PLC0415
        )
        from ..models.dashboard_chart_series_item_axis_label import (
            DashboardChartSeriesItemAxisLabel,  # noqa: PLC0415
        )
        from ..models.dashboard_chart_series_item_axis_line import (
            DashboardChartSeriesItemAxisLine,  # noqa: PLC0415
        )
        from ..models.dashboard_chart_series_item_axis_tick import (
            DashboardChartSeriesItemAxisTick,  # noqa: PLC0415
        )
        from ..models.dashboard_chart_series_item_detail import (
            DashboardChartSeriesItemDetail,  # noqa: PLC0415
        )
        from ..models.dashboard_chart_series_item_emphasis import (
            DashboardChartSeriesItemEmphasis,  # noqa: PLC0415
        )
        from ..models.dashboard_chart_series_item_encode import (
            DashboardChartSeriesItemEncode,  # noqa: PLC0415
        )
        from ..models.dashboard_chart_series_item_item_style import (
            DashboardChartSeriesItemItemStyle,  # noqa: PLC0415
        )
        from ..models.dashboard_chart_series_item_label import (
            DashboardChartSeriesItemLabel,  # noqa: PLC0415
        )
        from ..models.dashboard_chart_series_item_label_line import (
            DashboardChartSeriesItemLabelLine,  # noqa: PLC0415
        )
        from ..models.dashboard_chart_series_item_line_style import (
            DashboardChartSeriesItemLineStyle,  # noqa: PLC0415
        )
        from ..models.dashboard_chart_series_item_pointer import (
            DashboardChartSeriesItemPointer,  # noqa: PLC0415
        )
        from ..models.dashboard_chart_series_item_progress import (
            DashboardChartSeriesItemProgress,  # noqa: PLC0415
        )
        from ..models.dashboard_chart_series_item_split_line import (
            DashboardChartSeriesItemSplitLine,  # noqa: PLC0415
        )
        from ..models.dashboard_chart_series_item_title import (
            DashboardChartSeriesItemTitle,  # noqa: PLC0415
        )

        d = dict(src_dict)
        type_ = check_dashboard_chart_series_item_type(d.pop("type"))

        name = d.pop("name", UNSET)

        _encode = d.pop("encode", UNSET)
        encode: DashboardChartSeriesItemEncode | Unset
        if isinstance(_encode, Unset):
            encode = UNSET
        else:
            encode = DashboardChartSeriesItemEncode.from_dict(_encode)

        stack = d.pop("stack", UNSET)

        smooth = d.pop("smooth", UNSET)

        def _parse_step(
            data: object,
        ) -> bool | DashboardChartSeriesItemStepType1 | Unset:
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                step_type_1 = check_dashboard_chart_series_item_step_type_1(data)

                return step_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(bool | DashboardChartSeriesItemStepType1 | Unset, data)

        step = _parse_step(d.pop("step", UNSET))

        show_symbol = d.pop("showSymbol", UNSET)

        symbol = d.pop("symbol", UNSET)

        symbol_size = d.pop("symbolSize", UNSET)

        connect_nulls = d.pop("connectNulls", UNSET)

        _area_style = d.pop("areaStyle", UNSET)
        area_style: DashboardChartSeriesItemAreaStyle | Unset
        if isinstance(_area_style, Unset):
            area_style = UNSET
        else:
            area_style = DashboardChartSeriesItemAreaStyle.from_dict(_area_style)

        _line_style = d.pop("lineStyle", UNSET)
        line_style: DashboardChartSeriesItemLineStyle | Unset
        if isinstance(_line_style, Unset):
            line_style = UNSET
        else:
            line_style = DashboardChartSeriesItemLineStyle.from_dict(_line_style)

        _item_style = d.pop("itemStyle", UNSET)
        item_style: DashboardChartSeriesItemItemStyle | Unset
        if isinstance(_item_style, Unset):
            item_style = UNSET
        else:
            item_style = DashboardChartSeriesItemItemStyle.from_dict(_item_style)

        _label = d.pop("label", UNSET)
        label: DashboardChartSeriesItemLabel | Unset
        if isinstance(_label, Unset):
            label = UNSET
        else:
            label = DashboardChartSeriesItemLabel.from_dict(_label)

        _label_line = d.pop("labelLine", UNSET)
        label_line: DashboardChartSeriesItemLabelLine | Unset
        if isinstance(_label_line, Unset):
            label_line = UNSET
        else:
            label_line = DashboardChartSeriesItemLabelLine.from_dict(_label_line)

        _emphasis = d.pop("emphasis", UNSET)
        emphasis: DashboardChartSeriesItemEmphasis | Unset
        if isinstance(_emphasis, Unset):
            emphasis = UNSET
        else:
            emphasis = DashboardChartSeriesItemEmphasis.from_dict(_emphasis)

        def _parse_bar_width(data: object) -> float | str | Unset:
            if isinstance(data, Unset):
                return data
            return cast(float | str | Unset, data)

        bar_width = _parse_bar_width(d.pop("barWidth", UNSET))

        def _parse_bar_max_width(data: object) -> float | str | Unset:
            if isinstance(data, Unset):
                return data
            return cast(float | str | Unset, data)

        bar_max_width = _parse_bar_max_width(d.pop("barMaxWidth", UNSET))

        bar_gap = d.pop("barGap", UNSET)

        def _parse_radius(data: object) -> float | list[float | str] | str | Unset:
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, list):
                    raise TypeError()
                radius_type_1 = []
                _radius_type_1 = data
                for radius_type_1_item_data in _radius_type_1:

                    def _parse_radius_type_1_item(data: object) -> float | str:
                        return cast(float | str, data)

                    radius_type_1_item = _parse_radius_type_1_item(
                        radius_type_1_item_data
                    )

                    radius_type_1.append(radius_type_1_item)

                return radius_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(float | list[float | str] | str | Unset, data)

        radius = _parse_radius(d.pop("radius", UNSET))

        _center = d.pop("center", UNSET)
        center: list[float | str] | Unset = UNSET
        if _center is not UNSET:
            center = []
            for center_item_data in _center:

                def _parse_center_item(data: object) -> float | str:
                    return cast(float | str, data)

                center_item = _parse_center_item(center_item_data)

                center.append(center_item)

        def _parse_rose_type(
            data: object,
        ) -> bool | DashboardChartSeriesItemRoseTypeType1 | Unset:
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                rose_type_type_1 = check_dashboard_chart_series_item_rose_type_type_1(
                    data
                )

                return rose_type_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(bool | DashboardChartSeriesItemRoseTypeType1 | Unset, data)

        rose_type = _parse_rose_type(d.pop("roseType", UNSET))

        x_axis_index = d.pop("xAxisIndex", UNSET)

        y_axis_index = d.pop("yAxisIndex", UNSET)

        min_ = d.pop("min", UNSET)

        max_ = d.pop("max", UNSET)

        _progress = d.pop("progress", UNSET)
        progress: DashboardChartSeriesItemProgress | Unset
        if isinstance(_progress, Unset):
            progress = UNSET
        else:
            progress = DashboardChartSeriesItemProgress.from_dict(_progress)

        _detail = d.pop("detail", UNSET)
        detail: DashboardChartSeriesItemDetail | Unset
        if isinstance(_detail, Unset):
            detail = UNSET
        else:
            detail = DashboardChartSeriesItemDetail.from_dict(_detail)

        _axis_line = d.pop("axisLine", UNSET)
        axis_line: DashboardChartSeriesItemAxisLine | Unset
        if isinstance(_axis_line, Unset):
            axis_line = UNSET
        else:
            axis_line = DashboardChartSeriesItemAxisLine.from_dict(_axis_line)

        _pointer = d.pop("pointer", UNSET)
        pointer: DashboardChartSeriesItemPointer | Unset
        if isinstance(_pointer, Unset):
            pointer = UNSET
        else:
            pointer = DashboardChartSeriesItemPointer.from_dict(_pointer)

        _split_line = d.pop("splitLine", UNSET)
        split_line: DashboardChartSeriesItemSplitLine | Unset
        if isinstance(_split_line, Unset):
            split_line = UNSET
        else:
            split_line = DashboardChartSeriesItemSplitLine.from_dict(_split_line)

        _axis_label = d.pop("axisLabel", UNSET)
        axis_label: DashboardChartSeriesItemAxisLabel | Unset
        if isinstance(_axis_label, Unset):
            axis_label = UNSET
        else:
            axis_label = DashboardChartSeriesItemAxisLabel.from_dict(_axis_label)

        _axis_tick = d.pop("axisTick", UNSET)
        axis_tick: DashboardChartSeriesItemAxisTick | Unset
        if isinstance(_axis_tick, Unset):
            axis_tick = UNSET
        else:
            axis_tick = DashboardChartSeriesItemAxisTick.from_dict(_axis_tick)

        _title = d.pop("title", UNSET)
        title: DashboardChartSeriesItemTitle | Unset
        if isinstance(_title, Unset):
            title = UNSET
        else:
            title = DashboardChartSeriesItemTitle.from_dict(_title)

        dashboard_chart_series_item = cls(
            type_=type_,
            name=name,
            encode=encode,
            stack=stack,
            smooth=smooth,
            step=step,
            show_symbol=show_symbol,
            symbol=symbol,
            symbol_size=symbol_size,
            connect_nulls=connect_nulls,
            area_style=area_style,
            line_style=line_style,
            item_style=item_style,
            label=label,
            label_line=label_line,
            emphasis=emphasis,
            bar_width=bar_width,
            bar_max_width=bar_max_width,
            bar_gap=bar_gap,
            radius=radius,
            center=center,
            rose_type=rose_type,
            x_axis_index=x_axis_index,
            y_axis_index=y_axis_index,
            min_=min_,
            max_=max_,
            progress=progress,
            detail=detail,
            axis_line=axis_line,
            pointer=pointer,
            split_line=split_line,
            axis_label=axis_label,
            axis_tick=axis_tick,
            title=title,
        )

        return dashboard_chart_series_item
