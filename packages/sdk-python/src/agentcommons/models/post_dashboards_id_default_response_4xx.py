from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="PostDashboardsIdDefaultResponse4XX")


@_attrs_define
class PostDashboardsIdDefaultResponse4XX:
    """
    Attributes:
        code (str):
        message (str):
        position (int | None | Unset):
        detail (Any | Unset):
    """

    code: str
    message: str
    position: int | None | Unset = UNSET
    detail: Any | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        code = self.code

        message = self.message

        position: int | None | Unset
        if isinstance(self.position, Unset):
            position = UNSET
        else:
            position = self.position

        detail = self.detail

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "code": code,
                "message": message,
            }
        )
        if position is not UNSET:
            field_dict["position"] = position
        if detail is not UNSET:
            field_dict["detail"] = detail

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        code = d.pop("code")

        message = d.pop("message")

        def _parse_position(data: object) -> int | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(int | None | Unset, data)

        position = _parse_position(d.pop("position", UNSET))

        detail = d.pop("detail", UNSET)

        post_dashboards_id_default_response_4xx = cls(
            code=code,
            message=message,
            position=position,
            detail=detail,
        )

        return post_dashboards_id_default_response_4xx
