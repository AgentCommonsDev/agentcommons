from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.get_dashboards_response_200_items_item_created_by_type_0 import (
        GetDashboardsResponse200ItemsItemCreatedByType0,
    )


T = TypeVar("T", bound="GetDashboardsResponse200ItemsItem")


@_attrs_define
class GetDashboardsResponse200ItemsItem:
    """
    Attributes:
        id (UUID):
        organization_id (str):
        name (str):
        description (str):
        revision (int):
        builtin (bool):
        is_default (bool):
        can_edit (bool):
        created_by (GetDashboardsResponse200ItemsItemCreatedByType0 | None):
        tile_count (int):
        created_at (datetime.datetime):
        updated_at (datetime.datetime):
    """

    id: UUID
    organization_id: str
    name: str
    description: str
    revision: int
    builtin: bool
    is_default: bool
    can_edit: bool
    created_by: GetDashboardsResponse200ItemsItemCreatedByType0 | None
    tile_count: int
    created_at: datetime.datetime
    updated_at: datetime.datetime

    def to_dict(self) -> dict[str, Any]:
        from ..models.get_dashboards_response_200_items_item_created_by_type_0 import (
            GetDashboardsResponse200ItemsItemCreatedByType0,  # noqa: PLC0415
        )

        id = str(self.id)

        organization_id = self.organization_id

        name = self.name

        description = self.description

        revision = self.revision

        builtin = self.builtin

        is_default = self.is_default

        can_edit = self.can_edit

        created_by: dict[str, Any] | None
        if isinstance(self.created_by, GetDashboardsResponse200ItemsItemCreatedByType0):
            created_by = self.created_by.to_dict()
        else:
            created_by = self.created_by

        tile_count = self.tile_count

        created_at = self.created_at.isoformat()

        updated_at = self.updated_at.isoformat()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "organization_id": organization_id,
                "name": name,
                "description": description,
                "revision": revision,
                "builtin": builtin,
                "is_default": is_default,
                "can_edit": can_edit,
                "created_by": created_by,
                "tile_count": tile_count,
                "created_at": created_at,
                "updated_at": updated_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_dashboards_response_200_items_item_created_by_type_0 import (
            GetDashboardsResponse200ItemsItemCreatedByType0,  # noqa: PLC0415
        )

        d = dict(src_dict)
        id = UUID(d.pop("id"))

        organization_id = d.pop("organization_id")

        name = d.pop("name")

        description = d.pop("description")

        revision = d.pop("revision")

        builtin = d.pop("builtin")

        is_default = d.pop("is_default")

        can_edit = d.pop("can_edit")

        def _parse_created_by(
            data: object,
        ) -> GetDashboardsResponse200ItemsItemCreatedByType0 | None:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                created_by_type_0 = (
                    GetDashboardsResponse200ItemsItemCreatedByType0.from_dict(data)
                )

                return created_by_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(GetDashboardsResponse200ItemsItemCreatedByType0 | None, data)

        created_by = _parse_created_by(d.pop("created_by"))

        tile_count = d.pop("tile_count")

        created_at = datetime.datetime.fromisoformat(d.pop("created_at"))

        updated_at = datetime.datetime.fromisoformat(d.pop("updated_at"))

        get_dashboards_response_200_items_item = cls(
            id=id,
            organization_id=organization_id,
            name=name,
            description=description,
            revision=revision,
            builtin=builtin,
            is_default=is_default,
            can_edit=can_edit,
            created_by=created_by,
            tile_count=tile_count,
            created_at=created_at,
            updated_at=updated_at,
        )

        return get_dashboards_response_200_items_item
