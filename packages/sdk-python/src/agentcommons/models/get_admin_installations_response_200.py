from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.get_admin_installations_response_200_items_item import (
        GetAdminInstallationsResponse200ItemsItem,
    )
    from ..models.get_admin_installations_response_200_manifest_type_0 import (
        GetAdminInstallationsResponse200ManifestType0,
    )
    from ..models.get_admin_installations_response_200_total import (
        GetAdminInstallationsResponse200Total,
    )


T = TypeVar("T", bound="GetAdminInstallationsResponse200")


@_attrs_define
class GetAdminInstallationsResponse200:
    """
    Attributes:
        items (list[GetAdminInstallationsResponse200ItemsItem]):
        cursor (None | str):
        manifest (GetAdminInstallationsResponse200ManifestType0 | None): The hook bundle this instance serves at
            /hook/manifest.json, or null when none is served
        total (GetAdminInstallationsResponse200Total): Freshness counts over every matching installation, unchanged by
            the page window
    """

    items: list[GetAdminInstallationsResponse200ItemsItem]
    cursor: None | str
    manifest: GetAdminInstallationsResponse200ManifestType0 | None
    total: GetAdminInstallationsResponse200Total

    def to_dict(self) -> dict[str, Any]:
        from ..models.get_admin_installations_response_200_manifest_type_0 import (
            GetAdminInstallationsResponse200ManifestType0,  # noqa: PLC0415
        )

        items = []
        for items_item_data in self.items:
            items_item = items_item_data.to_dict()
            items.append(items_item)

        cursor: None | str
        cursor = self.cursor

        manifest: dict[str, Any] | None
        if isinstance(self.manifest, GetAdminInstallationsResponse200ManifestType0):
            manifest = self.manifest.to_dict()
        else:
            manifest = self.manifest

        total = self.total.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "items": items,
                "cursor": cursor,
                "manifest": manifest,
                "total": total,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_admin_installations_response_200_items_item import (
            GetAdminInstallationsResponse200ItemsItem,  # noqa: PLC0415
        )
        from ..models.get_admin_installations_response_200_manifest_type_0 import (
            GetAdminInstallationsResponse200ManifestType0,  # noqa: PLC0415
        )
        from ..models.get_admin_installations_response_200_total import (
            GetAdminInstallationsResponse200Total,  # noqa: PLC0415
        )

        d = dict(src_dict)
        items = []
        _items = d.pop("items")
        for items_item_data in _items:
            items_item = GetAdminInstallationsResponse200ItemsItem.from_dict(
                items_item_data
            )

            items.append(items_item)

        def _parse_cursor(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        cursor = _parse_cursor(d.pop("cursor"))

        def _parse_manifest(
            data: object,
        ) -> GetAdminInstallationsResponse200ManifestType0 | None:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                manifest_type_0 = (
                    GetAdminInstallationsResponse200ManifestType0.from_dict(data)
                )

                return manifest_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(GetAdminInstallationsResponse200ManifestType0 | None, data)

        manifest = _parse_manifest(d.pop("manifest"))

        total = GetAdminInstallationsResponse200Total.from_dict(d.pop("total"))

        get_admin_installations_response_200 = cls(
            items=items,
            cursor=cursor,
            manifest=manifest,
            total=total,
        )

        return get_admin_installations_response_200
