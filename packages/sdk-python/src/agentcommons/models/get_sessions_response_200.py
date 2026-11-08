from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.get_sessions_response_200_items_item import (
        GetSessionsResponse200ItemsItem,
    )
    from ..models.get_sessions_response_200_total import GetSessionsResponse200Total


T = TypeVar("T", bound="GetSessionsResponse200")


@_attrs_define
class GetSessionsResponse200:
    """
    Attributes:
        items (list[GetSessionsResponse200ItemsItem]):
        cursor (None | str):
        total (GetSessionsResponse200Total): Totals over every matching session, computed with the same filters and
            roots_only as the page
    """

    items: list[GetSessionsResponse200ItemsItem]
    cursor: None | str
    total: GetSessionsResponse200Total

    def to_dict(self) -> dict[str, Any]:
        items = []
        for items_item_data in self.items:
            items_item = items_item_data.to_dict()
            items.append(items_item)

        cursor: None | str
        cursor = self.cursor

        total = self.total.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "items": items,
                "cursor": cursor,
                "total": total,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_sessions_response_200_items_item import (
            GetSessionsResponse200ItemsItem,  # noqa: PLC0415
        )
        from ..models.get_sessions_response_200_total import (
            GetSessionsResponse200Total,  # noqa: PLC0415
        )

        d = dict(src_dict)
        items = []
        _items = d.pop("items")
        for items_item_data in _items:
            items_item = GetSessionsResponse200ItemsItem.from_dict(items_item_data)

            items.append(items_item)

        def _parse_cursor(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        cursor = _parse_cursor(d.pop("cursor"))

        total = GetSessionsResponse200Total.from_dict(d.pop("total"))

        get_sessions_response_200 = cls(
            items=items,
            cursor=cursor,
            total=total,
        )

        return get_sessions_response_200
