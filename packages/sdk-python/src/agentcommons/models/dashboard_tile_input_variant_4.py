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
    from ..models.dashboard_tile_input_variant_4_layout import (
        DashboardTileInputVariant4Layout,
    )


T = TypeVar("T", bound="DashboardTileInputVariant4")


@_attrs_define
class DashboardTileInputVariant4:
    """
    Attributes:
        id (str):
        title (str):
        layout (DashboardTileInputVariant4Layout):
        type_ (Literal['control']):
        variable (str):
        description (str | Unset):
    """

    id: str
    title: str
    layout: DashboardTileInputVariant4Layout
    type_: Literal["control"]
    variable: str
    description: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        title = self.title

        layout = self.layout.to_dict()

        type_ = self.type_

        variable = self.variable

        description = self.description

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "title": title,
                "layout": layout,
                "type": type_,
                "variable": variable,
            }
        )
        if description is not UNSET:
            field_dict["description"] = description

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.dashboard_tile_input_variant_4_layout import (
            DashboardTileInputVariant4Layout,  # noqa: PLC0415
        )

        d = dict(src_dict)
        id = d.pop("id")

        title = d.pop("title")

        layout = DashboardTileInputVariant4Layout.from_dict(d.pop("layout"))

        type_ = cast(Literal["control"], d.pop("type"))
        if type_ != "control":
            raise ValueError(f"type must match const 'control', got '{type_}'")

        variable = d.pop("variable")

        description = d.pop("description", UNSET)

        dashboard_tile_input_variant_4 = cls(
            id=id,
            title=title,
            layout=layout,
            type_=type_,
            variable=variable,
            description=description,
        )

        return dashboard_tile_input_variant_4
