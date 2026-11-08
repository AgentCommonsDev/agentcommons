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

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.dashboard_tile_variant_2_layout import DashboardTileVariant2Layout


T = TypeVar("T", bound="DashboardTileVariant2")


@_attrs_define
class DashboardTileVariant2:
    """
    Attributes:
        id (str):
        title (str):
        layout (DashboardTileVariant2Layout):
        type_ (Literal['table']):
        sql (str):
        description (str | Unset):
        columns (list[str] | Unset):
    """

    id: str
    title: str
    layout: DashboardTileVariant2Layout
    type_: Literal["table"]
    sql: str
    description: str | Unset = UNSET
    columns: list[str] | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        title = self.title

        layout = self.layout.to_dict()

        type_ = self.type_

        sql = self.sql

        description = self.description

        columns: list[str] | Unset = UNSET
        if not isinstance(self.columns, Unset):
            columns = self.columns

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
        if columns is not UNSET:
            field_dict["columns"] = columns

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.dashboard_tile_variant_2_layout import (
            DashboardTileVariant2Layout,  # noqa: PLC0415
        )

        d = dict(src_dict)
        id = d.pop("id")

        title = d.pop("title")

        layout = DashboardTileVariant2Layout.from_dict(d.pop("layout"))

        type_ = cast(Literal["table"], d.pop("type"))
        if type_ != "table":
            raise ValueError(f"type must match const 'table', got '{type_}'")

        sql = d.pop("sql")

        description = d.pop("description", UNSET)

        columns = cast(list[str], d.pop("columns", UNSET))

        dashboard_tile_variant_2 = cls(
            id=id,
            title=title,
            layout=layout,
            type_=type_,
            sql=sql,
            description=description,
            columns=columns,
        )

        return dashboard_tile_variant_2
