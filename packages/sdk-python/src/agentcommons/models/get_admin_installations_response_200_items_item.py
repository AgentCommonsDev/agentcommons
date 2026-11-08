from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define

T = TypeVar("T", bound="GetAdminInstallationsResponse200ItemsItem")


@_attrs_define
class GetAdminInstallationsResponse200ItemsItem:
    """
    Attributes:
        installation_id (UUID): Install id; matches sessions.installation_id
        hostname (str): Machine hostname
        os_user (str): Operating-system user
        platform (str): Operating system, such as darwin or linux
        arch (str): CPU architecture
        tools_enabled (bool): Whether the AgentCommons MCP tools are installed there
        hook_sha256 (None | str): SHA-256 of the installed hook script
        up_to_date (bool | None): True when this machine's hook digest matches the served manifest; false when it
            reports an older digest; null when it has reported no digest or no manifest is served
        first_seen_at (datetime.datetime): Earliest session start
        last_seen_at (datetime.datetime): Latest session activity
    """

    installation_id: UUID
    hostname: str
    os_user: str
    platform: str
    arch: str
    tools_enabled: bool
    hook_sha256: None | str
    up_to_date: bool | None
    first_seen_at: datetime.datetime
    last_seen_at: datetime.datetime

    def to_dict(self) -> dict[str, Any]:
        installation_id = str(self.installation_id)

        hostname = self.hostname

        os_user = self.os_user

        platform = self.platform

        arch = self.arch

        tools_enabled = self.tools_enabled

        hook_sha256: None | str
        hook_sha256 = self.hook_sha256

        up_to_date: bool | None
        up_to_date = self.up_to_date

        first_seen_at = self.first_seen_at.isoformat()

        last_seen_at = self.last_seen_at.isoformat()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "installation_id": installation_id,
                "hostname": hostname,
                "os_user": os_user,
                "platform": platform,
                "arch": arch,
                "tools_enabled": tools_enabled,
                "hook_sha256": hook_sha256,
                "up_to_date": up_to_date,
                "first_seen_at": first_seen_at,
                "last_seen_at": last_seen_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        installation_id = UUID(d.pop("installation_id"))

        hostname = d.pop("hostname")

        os_user = d.pop("os_user")

        platform = d.pop("platform")

        arch = d.pop("arch")

        tools_enabled = d.pop("tools_enabled")

        def _parse_hook_sha256(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        hook_sha256 = _parse_hook_sha256(d.pop("hook_sha256"))

        def _parse_up_to_date(data: object) -> bool | None:
            if data is None:
                return data
            return cast(bool | None, data)

        up_to_date = _parse_up_to_date(d.pop("up_to_date"))

        first_seen_at = datetime.datetime.fromisoformat(d.pop("first_seen_at"))

        last_seen_at = datetime.datetime.fromisoformat(d.pop("last_seen_at"))

        get_admin_installations_response_200_items_item = cls(
            installation_id=installation_id,
            hostname=hostname,
            os_user=os_user,
            platform=platform,
            arch=arch,
            tools_enabled=tools_enabled,
            hook_sha256=hook_sha256,
            up_to_date=up_to_date,
            first_seen_at=first_seen_at,
            last_seen_at=last_seen_at,
        )

        return get_admin_installations_response_200_items_item
