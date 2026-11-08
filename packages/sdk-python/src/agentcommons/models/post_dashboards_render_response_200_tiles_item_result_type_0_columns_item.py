from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="PostDashboardsRenderResponse200TilesItemResultType0ColumnsItem")


@_attrs_define
class PostDashboardsRenderResponse200TilesItemResultType0ColumnsItem:
    """
    Attributes:
        name (str):
        type_ (str):
    """

    name: str
    type_: str

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        type_ = self.type_

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "name": name,
                "type": type_,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        name = d.pop("name")

        type_ = d.pop("type")

        post_dashboards_render_response_200_tiles_item_result_type_0_columns_item = cls(
            name=name,
            type_=type_,
        )

        return post_dashboards_render_response_200_tiles_item_result_type_0_columns_item
