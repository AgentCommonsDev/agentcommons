from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="PostDashboardsRenderResponse200TilesItemErrorType0")


@_attrs_define
class PostDashboardsRenderResponse200TilesItemErrorType0:
    """
    Attributes:
        code (str):
        message (str):
    """

    code: str
    message: str

    def to_dict(self) -> dict[str, Any]:
        code = self.code

        message = self.message

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "code": code,
                "message": message,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        code = d.pop("code")

        message = d.pop("message")

        post_dashboards_render_response_200_tiles_item_error_type_0 = cls(
            code=code,
            message=message,
        )

        return post_dashboards_render_response_200_tiles_item_error_type_0
