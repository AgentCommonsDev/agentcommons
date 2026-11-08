from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.post_dashboards_render_response_200_tiles_item_error_type_0 import (
        PostDashboardsRenderResponse200TilesItemErrorType0,
    )
    from ..models.post_dashboards_render_response_200_tiles_item_result_type_0 import (
        PostDashboardsRenderResponse200TilesItemResultType0,
    )


T = TypeVar("T", bound="PostDashboardsRenderResponse200TilesItem")


@_attrs_define
class PostDashboardsRenderResponse200TilesItem:
    """
    Attributes:
        id (str):
        result (None | PostDashboardsRenderResponse200TilesItemResultType0):
        error (None | PostDashboardsRenderResponse200TilesItemErrorType0):
    """

    id: str
    result: None | PostDashboardsRenderResponse200TilesItemResultType0
    error: None | PostDashboardsRenderResponse200TilesItemErrorType0

    def to_dict(self) -> dict[str, Any]:
        from ..models.post_dashboards_render_response_200_tiles_item_error_type_0 import (
            PostDashboardsRenderResponse200TilesItemErrorType0,  # noqa: PLC0415
        )
        from ..models.post_dashboards_render_response_200_tiles_item_result_type_0 import (
            PostDashboardsRenderResponse200TilesItemResultType0,  # noqa: PLC0415
        )

        id = self.id

        result: dict[str, Any] | None
        if isinstance(self.result, PostDashboardsRenderResponse200TilesItemResultType0):
            result = self.result.to_dict()
        else:
            result = self.result

        error: dict[str, Any] | None
        if isinstance(self.error, PostDashboardsRenderResponse200TilesItemErrorType0):
            error = self.error.to_dict()
        else:
            error = self.error

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "result": result,
                "error": error,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_dashboards_render_response_200_tiles_item_error_type_0 import (
            PostDashboardsRenderResponse200TilesItemErrorType0,  # noqa: PLC0415
        )
        from ..models.post_dashboards_render_response_200_tiles_item_result_type_0 import (
            PostDashboardsRenderResponse200TilesItemResultType0,  # noqa: PLC0415
        )

        d = dict(src_dict)
        id = d.pop("id")

        def _parse_result(
            data: object,
        ) -> None | PostDashboardsRenderResponse200TilesItemResultType0:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                result_type_0 = (
                    PostDashboardsRenderResponse200TilesItemResultType0.from_dict(data)
                )

                return result_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(
                None | PostDashboardsRenderResponse200TilesItemResultType0, data
            )

        result = _parse_result(d.pop("result"))

        def _parse_error(
            data: object,
        ) -> None | PostDashboardsRenderResponse200TilesItemErrorType0:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                error_type_0 = (
                    PostDashboardsRenderResponse200TilesItemErrorType0.from_dict(data)
                )

                return error_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | PostDashboardsRenderResponse200TilesItemErrorType0, data)

        error = _parse_error(d.pop("error"))

        post_dashboards_render_response_200_tiles_item = cls(
            id=id,
            result=result,
            error=error,
        )

        return post_dashboards_render_response_200_tiles_item
