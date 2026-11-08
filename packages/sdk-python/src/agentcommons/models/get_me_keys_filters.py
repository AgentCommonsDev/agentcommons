from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.get_me_keys_filters_tool_group import (
    GetMeKeysFiltersToolGroup,
    check_get_me_keys_filters_tool_group,
)
from ..types import UNSET, Unset

T = TypeVar("T", bound="GetMeKeysFilters")


@_attrs_define
class GetMeKeysFilters:
    """
    Attributes:
        user_id (str | Unset):
        enabled (bool | Unset):
        tool_group (GetMeKeysFiltersToolGroup | Unset): Only keys whose permissions grant this MCP tool group
            (dashboards, administration)
    """

    user_id: str | Unset = UNSET
    enabled: bool | Unset = UNSET
    tool_group: GetMeKeysFiltersToolGroup | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        user_id = self.user_id

        enabled = self.enabled

        tool_group: str | Unset = UNSET
        if not isinstance(self.tool_group, Unset):
            tool_group = self.tool_group

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if user_id is not UNSET:
            field_dict["user_id"] = user_id
        if enabled is not UNSET:
            field_dict["enabled"] = enabled
        if tool_group is not UNSET:
            field_dict["tool_group"] = tool_group

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        user_id = d.pop("user_id", UNSET)

        enabled = d.pop("enabled", UNSET)

        _tool_group = d.pop("tool_group", UNSET)
        tool_group: GetMeKeysFiltersToolGroup | Unset
        if isinstance(_tool_group, Unset):
            tool_group = UNSET
        else:
            tool_group = check_get_me_keys_filters_tool_group(_tool_group)

        get_me_keys_filters = cls(
            user_id=user_id,
            enabled=enabled,
            tool_group=tool_group,
        )

        return get_me_keys_filters
