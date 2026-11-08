from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.get_admin_users_response_200_items_item import (
        GetAdminUsersResponse200ItemsItem,
    )


T = TypeVar("T", bound="GetAdminUsersResponse200")


@_attrs_define
class GetAdminUsersResponse200:
    """
    Attributes:
        items (list[GetAdminUsersResponse200ItemsItem]):
        cursor (None | str):
    """

    items: list[GetAdminUsersResponse200ItemsItem]
    cursor: None | str

    def to_dict(self) -> dict[str, Any]:
        items = []
        for items_item_data in self.items:
            items_item = items_item_data.to_dict()
            items.append(items_item)

        cursor: None | str
        cursor = self.cursor

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "items": items,
                "cursor": cursor,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_admin_users_response_200_items_item import (
            GetAdminUsersResponse200ItemsItem,  # noqa: PLC0415
        )

        d = dict(src_dict)
        items = []
        _items = d.pop("items")
        for items_item_data in _items:
            items_item = GetAdminUsersResponse200ItemsItem.from_dict(items_item_data)

            items.append(items_item)

        def _parse_cursor(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        cursor = _parse_cursor(d.pop("cursor"))

        get_admin_users_response_200 = cls(
            items=items,
            cursor=cursor,
        )

        return get_admin_users_response_200
