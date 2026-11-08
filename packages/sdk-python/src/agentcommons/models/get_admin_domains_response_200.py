from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.get_admin_domains_response_200_items_item import (
        GetAdminDomainsResponse200ItemsItem,
    )


T = TypeVar("T", bound="GetAdminDomainsResponse200")


@_attrs_define
class GetAdminDomainsResponse200:
    """
    Attributes:
        enabled (bool):
        items (list[GetAdminDomainsResponse200ItemsItem]):
        cursor (None | str):
    """

    enabled: bool
    items: list[GetAdminDomainsResponse200ItemsItem]
    cursor: None | str

    def to_dict(self) -> dict[str, Any]:
        enabled = self.enabled

        items = []
        for items_item_data in self.items:
            items_item = items_item_data.to_dict()
            items.append(items_item)

        cursor: None | str
        cursor = self.cursor

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "enabled": enabled,
                "items": items,
                "cursor": cursor,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_admin_domains_response_200_items_item import (
            GetAdminDomainsResponse200ItemsItem,  # noqa: PLC0415
        )

        d = dict(src_dict)
        enabled = d.pop("enabled")

        items = []
        _items = d.pop("items")
        for items_item_data in _items:
            items_item = GetAdminDomainsResponse200ItemsItem.from_dict(items_item_data)

            items.append(items_item)

        def _parse_cursor(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        cursor = _parse_cursor(d.pop("cursor"))

        get_admin_domains_response_200 = cls(
            enabled=enabled,
            items=items,
            cursor=cursor,
        )

        return get_admin_domains_response_200
