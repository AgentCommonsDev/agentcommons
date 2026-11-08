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

from ..models.dashboard_tile_input_variant_0_unit import (
    DashboardTileInputVariant0Unit,
    check_dashboard_tile_input_variant_0_unit,
)
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.dashboard_tile_input_variant_0_layout import (
        DashboardTileInputVariant0Layout,
    )


T = TypeVar("T", bound="DashboardTileInputVariant0")


@_attrs_define
class DashboardTileInputVariant0:
    """
    Attributes:
        id (str):
        title (str):
        layout (DashboardTileInputVariant0Layout):
        type_ (Literal['stat']):
        sql (str):
        description (str | Unset):
        value (str | Unset):
        compare (str | Unset):
        unit (DashboardTileInputVariant0Unit | Unset):  Default: 'count'.
    """

    id: str
    title: str
    layout: DashboardTileInputVariant0Layout
    type_: Literal["stat"]
    sql: str
    description: str | Unset = UNSET
    value: str | Unset = UNSET
    compare: str | Unset = UNSET
    unit: DashboardTileInputVariant0Unit | Unset = "count"

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        title = self.title

        layout = self.layout.to_dict()

        type_ = self.type_

        sql = self.sql

        description = self.description

        value = self.value

        compare = self.compare

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
            }
        )
        if description is not UNSET:
            field_dict["description"] = description
        if value is not UNSET:
            field_dict["value"] = value
        if compare is not UNSET:
            field_dict["compare"] = compare
        if unit is not UNSET:
            field_dict["unit"] = unit

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.dashboard_tile_input_variant_0_layout import (
            DashboardTileInputVariant0Layout,  # noqa: PLC0415
        )

        d = dict(src_dict)
        id = d.pop("id")

        title = d.pop("title")

        layout = DashboardTileInputVariant0Layout.from_dict(d.pop("layout"))

        type_ = cast(Literal["stat"], d.pop("type"))
        if type_ != "stat":
            raise ValueError(f"type must match const 'stat', got '{type_}'")

        sql = d.pop("sql")

        description = d.pop("description", UNSET)

        value = d.pop("value", UNSET)

        compare = d.pop("compare", UNSET)

        _unit = d.pop("unit", UNSET)
        unit: DashboardTileInputVariant0Unit | Unset
        if isinstance(_unit, Unset):
            unit = UNSET
        else:
            unit = check_dashboard_tile_input_variant_0_unit(_unit)

        dashboard_tile_input_variant_0 = cls(
            id=id,
            title=title,
            layout=layout,
            type_=type_,
            sql=sql,
            description=description,
            value=value,
            compare=compare,
            unit=unit,
        )

        return dashboard_tile_input_variant_0
