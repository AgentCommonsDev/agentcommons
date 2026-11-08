from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="GetInstallationsFilters")


@_attrs_define
class GetInstallationsFilters:
    """
    Attributes:
        hostname (str | Unset):
        tools_enabled (bool | Unset):
    """

    hostname: str | Unset = UNSET
    tools_enabled: bool | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        hostname = self.hostname

        tools_enabled = self.tools_enabled

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if hostname is not UNSET:
            field_dict["hostname"] = hostname
        if tools_enabled is not UNSET:
            field_dict["tools_enabled"] = tools_enabled

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        hostname = d.pop("hostname", UNSET)

        tools_enabled = d.pop("tools_enabled", UNSET)

        get_installations_filters = cls(
            hostname=hostname,
            tools_enabled=tools_enabled,
        )

        return get_installations_filters
