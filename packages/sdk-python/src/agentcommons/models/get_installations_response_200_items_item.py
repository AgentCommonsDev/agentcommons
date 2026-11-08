from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define

T = TypeVar("T", bound="GetInstallationsResponse200ItemsItem")


@_attrs_define
class GetInstallationsResponse200ItemsItem:
    """
    Attributes:
        installation_id (UUID): Install id; matches sessions.installation_id
        tools_enabled (bool): Whether the AgentCommons MCP tools are installed there
        organization_id (str): Owning organization (already scoped)
        hostname (str): Machine hostname
        os_user (str): Operating-system user
        platform (str): Operating system, such as darwin or linux
        arch (str): CPU architecture
        hook_sha256 (None | str): SHA-256 of the installed hook script
        first_seen_at (datetime.datetime): Earliest session start
        last_seen_at (datetime.datetime): Latest session activity
        session_count (int): Visible sessions captured
        truncated_fields (list[str]): Fields shortened to fit the response
    """

    installation_id: UUID
    tools_enabled: bool
    organization_id: str
    hostname: str
    os_user: str
    platform: str
    arch: str
    hook_sha256: None | str
    first_seen_at: datetime.datetime
    last_seen_at: datetime.datetime
    session_count: int
    truncated_fields: list[str]

    def to_dict(self) -> dict[str, Any]:
        installation_id = str(self.installation_id)

        tools_enabled = self.tools_enabled

        organization_id = self.organization_id

        hostname = self.hostname

        os_user = self.os_user

        platform = self.platform

        arch = self.arch

        hook_sha256: None | str
        hook_sha256 = self.hook_sha256

        first_seen_at = self.first_seen_at.isoformat()

        last_seen_at = self.last_seen_at.isoformat()

        session_count = self.session_count

        truncated_fields = self.truncated_fields

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "installation_id": installation_id,
                "tools_enabled": tools_enabled,
                "organization_id": organization_id,
                "hostname": hostname,
                "os_user": os_user,
                "platform": platform,
                "arch": arch,
                "hook_sha256": hook_sha256,
                "first_seen_at": first_seen_at,
                "last_seen_at": last_seen_at,
                "session_count": session_count,
                "truncated_fields": truncated_fields,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        installation_id = UUID(d.pop("installation_id"))

        tools_enabled = d.pop("tools_enabled")

        organization_id = d.pop("organization_id")

        hostname = d.pop("hostname")

        os_user = d.pop("os_user")

        platform = d.pop("platform")

        arch = d.pop("arch")

        def _parse_hook_sha256(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        hook_sha256 = _parse_hook_sha256(d.pop("hook_sha256"))

        first_seen_at = datetime.datetime.fromisoformat(d.pop("first_seen_at"))

        last_seen_at = datetime.datetime.fromisoformat(d.pop("last_seen_at"))

        session_count = d.pop("session_count")

        truncated_fields = cast(list[str], d.pop("truncated_fields"))

        get_installations_response_200_items_item = cls(
            installation_id=installation_id,
            tools_enabled=tools_enabled,
            organization_id=organization_id,
            hostname=hostname,
            os_user=os_user,
            platform=platform,
            arch=arch,
            hook_sha256=hook_sha256,
            first_seen_at=first_seen_at,
            last_seen_at=last_seen_at,
            session_count=session_count,
            truncated_fields=truncated_fields,
        )

        return get_installations_response_200_items_item
