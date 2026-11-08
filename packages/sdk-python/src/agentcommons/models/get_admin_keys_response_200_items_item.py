from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.get_admin_keys_response_200_items_item_permissions import (
        GetAdminKeysResponse200ItemsItemPermissions,
    )


T = TypeVar("T", bound="GetAdminKeysResponse200ItemsItem")


@_attrs_define
class GetAdminKeysResponse200ItemsItem:
    """
    Attributes:
        id (str):
        organization_id (str):
        user_id (str):
        user_email (None | str):
        user_name (None | str):
        name (None | str):
        prefix (None | str):
        permissions (GetAdminKeysResponse200ItemsItemPermissions):
        enabled (bool):
        created_at (datetime.datetime):
        expires_at (datetime.datetime | None):
        last_used_at (datetime.datetime | None):
    """

    id: str
    organization_id: str
    user_id: str
    user_email: None | str
    user_name: None | str
    name: None | str
    prefix: None | str
    permissions: GetAdminKeysResponse200ItemsItemPermissions
    enabled: bool
    created_at: datetime.datetime
    expires_at: datetime.datetime | None
    last_used_at: datetime.datetime | None

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        organization_id = self.organization_id

        user_id = self.user_id

        user_email: None | str
        user_email = self.user_email

        user_name: None | str
        user_name = self.user_name

        name: None | str
        name = self.name

        prefix: None | str
        prefix = self.prefix

        permissions = self.permissions.to_dict()

        enabled = self.enabled

        created_at = self.created_at.isoformat()

        expires_at: None | str
        if isinstance(self.expires_at, datetime.datetime):
            expires_at = self.expires_at.isoformat()
        else:
            expires_at = self.expires_at

        last_used_at: None | str
        if isinstance(self.last_used_at, datetime.datetime):
            last_used_at = self.last_used_at.isoformat()
        else:
            last_used_at = self.last_used_at

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "organization_id": organization_id,
                "user_id": user_id,
                "user_email": user_email,
                "user_name": user_name,
                "name": name,
                "prefix": prefix,
                "permissions": permissions,
                "enabled": enabled,
                "created_at": created_at,
                "expires_at": expires_at,
                "last_used_at": last_used_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_admin_keys_response_200_items_item_permissions import (
            GetAdminKeysResponse200ItemsItemPermissions,  # noqa: PLC0415
        )

        d = dict(src_dict)
        id = d.pop("id")

        organization_id = d.pop("organization_id")

        user_id = d.pop("user_id")

        def _parse_user_email(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        user_email = _parse_user_email(d.pop("user_email"))

        def _parse_user_name(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        user_name = _parse_user_name(d.pop("user_name"))

        def _parse_name(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        name = _parse_name(d.pop("name"))

        def _parse_prefix(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        prefix = _parse_prefix(d.pop("prefix"))

        permissions = GetAdminKeysResponse200ItemsItemPermissions.from_dict(
            d.pop("permissions")
        )

        enabled = d.pop("enabled")

        created_at = datetime.datetime.fromisoformat(d.pop("created_at"))

        def _parse_expires_at(data: object) -> datetime.datetime | None:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                expires_at_type_0 = datetime.datetime.fromisoformat(data)

                return expires_at_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None, data)

        expires_at = _parse_expires_at(d.pop("expires_at"))

        def _parse_last_used_at(data: object) -> datetime.datetime | None:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                last_used_at_type_0 = datetime.datetime.fromisoformat(data)

                return last_used_at_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None, data)

        last_used_at = _parse_last_used_at(d.pop("last_used_at"))

        get_admin_keys_response_200_items_item = cls(
            id=id,
            organization_id=organization_id,
            user_id=user_id,
            user_email=user_email,
            user_name=user_name,
            name=name,
            prefix=prefix,
            permissions=permissions,
            enabled=enabled,
            created_at=created_at,
            expires_at=expires_at,
            last_used_at=last_used_at,
        )

        return get_admin_keys_response_200_items_item
