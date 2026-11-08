from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="PostAdminInstallationsIdToolsBody")


@_attrs_define
class PostAdminInstallationsIdToolsBody:
    """
    Attributes:
        reason (str):
        enabled (bool):
    """

    reason: str
    enabled: bool

    def to_dict(self) -> dict[str, Any]:
        reason = self.reason

        enabled = self.enabled

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "reason": reason,
                "enabled": enabled,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        reason = d.pop("reason")

        enabled = d.pop("enabled")

        post_admin_installations_id_tools_body = cls(
            reason=reason,
            enabled=enabled,
        )

        return post_admin_installations_id_tools_body
