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

from ..models.dashboard_tile_variant_0_unit import (
    DashboardTileVariant0Unit,
    check_dashboard_tile_variant_0_unit,
)
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.dashboard_tile_variant_0_layout import DashboardTileVariant0Layout


T = TypeVar("T", bound="DashboardTileVariant0")


@_attrs_define
class DashboardTileVariant0:
    """
    Attributes:
        id (str):
        title (str):
        layout (DashboardTileVariant0Layout):
        type_ (Literal['stat']):
        sql (str):
        unit (DashboardTileVariant0Unit):  Default: 'count'.
        description (str | Unset):
        value (str | Unset):
        compare (str | Unset):
    """

    id: str
    title: str
    layout: DashboardTileVariant0Layout
    type_: Literal["stat"]
    sql: str
    unit: DashboardTileVariant0Unit = "count"
    description: str | Unset = UNSET
    value: str | Unset = UNSET
    compare: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        title = self.title

        layout = self.layout.to_dict()

        type_ = self.type_

        sql = self.sql

        unit: str = self.unit

        description = self.description

        value = self.value

        compare = self.compare

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "title": title,
                "layout": layout,
                "type": type_,
                "sql": sql,
                "unit": unit,
            }
        )
        if description is not UNSET:
            field_dict["description"] = description
        if value is not UNSET:
            field_dict["value"] = value
        if compare is not UNSET:
            field_dict["compare"] = compare

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.dashboard_tile_variant_0_layout import (
            DashboardTileVariant0Layout,  # noqa: PLC0415
        )

        d = dict(src_dict)
        id = d.pop("id")

        title = d.pop("title")

        layout = DashboardTileVariant0Layout.from_dict(d.pop("layout"))

        type_ = cast(Literal["stat"], d.pop("type"))
        if type_ != "stat":
            raise ValueError(f"type must match const 'stat', got '{type_}'")

        sql = d.pop("sql")

        unit = check_dashboard_tile_variant_0_unit(d.pop("unit"))

        description = d.pop("description", UNSET)

        value = d.pop("value", UNSET)

        compare = d.pop("compare", UNSET)

        dashboard_tile_variant_0 = cls(
            id=id,
            title=title,
            layout=layout,
            type_=type_,
            sql=sql,
            unit=unit,
            description=description,
            value=value,
            compare=compare,
        )

        return dashboard_tile_variant_0
