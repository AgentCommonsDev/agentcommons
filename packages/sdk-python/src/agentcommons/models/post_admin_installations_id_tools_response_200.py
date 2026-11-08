from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar
from uuid import UUID

from attrs import define as _attrs_define

T = TypeVar("T", bound="PostAdminInstallationsIdToolsResponse200")


@_attrs_define
class PostAdminInstallationsIdToolsResponse200:
    """
    Attributes:
        installation_id (UUID):
        tools_enabled (bool):
    """

    installation_id: UUID
    tools_enabled: bool

    def to_dict(self) -> dict[str, Any]:
        installation_id = str(self.installation_id)

        tools_enabled = self.tools_enabled

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "installation_id": installation_id,
                "tools_enabled": tools_enabled,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        installation_id = UUID(d.pop("installation_id"))

        tools_enabled = d.pop("tools_enabled")

        post_admin_installations_id_tools_response_200 = cls(
            installation_id=installation_id,
            tools_enabled=tools_enabled,
        )

        return post_admin_installations_id_tools_response_200
