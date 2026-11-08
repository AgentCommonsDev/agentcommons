from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.post_dashboards_render_response_200_tiles_item import (
        PostDashboardsRenderResponse200TilesItem,
    )
    from ..models.post_dashboards_render_response_200_variables import (
        PostDashboardsRenderResponse200Variables,
    )


T = TypeVar("T", bound="PostDashboardsRenderResponse200")


@_attrs_define
class PostDashboardsRenderResponse200:
    """
    Attributes:
        tiles (list[PostDashboardsRenderResponse200TilesItem]):
        variables (PostDashboardsRenderResponse200Variables):
        rendered_at (datetime.datetime):
        cached (bool):
    """

    tiles: list[PostDashboardsRenderResponse200TilesItem]
    variables: PostDashboardsRenderResponse200Variables
    rendered_at: datetime.datetime
    cached: bool

    def to_dict(self) -> dict[str, Any]:
        tiles = []
        for tiles_item_data in self.tiles:
            tiles_item = tiles_item_data.to_dict()
            tiles.append(tiles_item)

        variables = self.variables.to_dict()

        rendered_at = self.rendered_at.isoformat()

        cached = self.cached

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "tiles": tiles,
                "variables": variables,
                "rendered_at": rendered_at,
                "cached": cached,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_dashboards_render_response_200_tiles_item import (
            PostDashboardsRenderResponse200TilesItem,  # noqa: PLC0415
        )
        from ..models.post_dashboards_render_response_200_variables import (
            PostDashboardsRenderResponse200Variables,  # noqa: PLC0415
        )

        d = dict(src_dict)
        tiles = []
        _tiles = d.pop("tiles")
        for tiles_item_data in _tiles:
            tiles_item = PostDashboardsRenderResponse200TilesItem.from_dict(
                tiles_item_data
            )

            tiles.append(tiles_item)

        variables = PostDashboardsRenderResponse200Variables.from_dict(
            d.pop("variables")
        )

        rendered_at = datetime.datetime.fromisoformat(d.pop("rendered_at"))

        cached = d.pop("cached")

        post_dashboards_render_response_200 = cls(
            tiles=tiles,
            variables=variables,
            rendered_at=rendered_at,
            cached=cached,
        )

        return post_dashboards_render_response_200
