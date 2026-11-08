from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.get_admin_keys_response_200_items_item_permissions_admin_item import (
    GetAdminKeysResponse200ItemsItemPermissionsAdminItem,
    check_get_admin_keys_response_200_items_item_permissions_admin_item,
)
from ..models.get_admin_keys_response_200_items_item_permissions_sessions_item import (
    GetAdminKeysResponse200ItemsItemPermissionsSessionsItem,
    check_get_admin_keys_response_200_items_item_permissions_sessions_item,
)
from ..models.get_admin_keys_response_200_items_item_permissions_tools_item import (
    GetAdminKeysResponse200ItemsItemPermissionsToolsItem,
    check_get_admin_keys_response_200_items_item_permissions_tools_item,
)
from ..types import UNSET, Unset

T = TypeVar("T", bound="GetAdminKeysResponse200ItemsItemPermissions")


@_attrs_define
class GetAdminKeysResponse200ItemsItemPermissions:
    """
    Attributes:
        sessions (list[GetAdminKeysResponse200ItemsItemPermissionsSessionsItem] | Unset):
        tools (list[GetAdminKeysResponse200ItemsItemPermissionsToolsItem] | Unset):
        admin (list[GetAdminKeysResponse200ItemsItemPermissionsAdminItem] | Unset):
    """

    sessions: list[GetAdminKeysResponse200ItemsItemPermissionsSessionsItem] | Unset = (
        UNSET
    )
    tools: list[GetAdminKeysResponse200ItemsItemPermissionsToolsItem] | Unset = UNSET
    admin: list[GetAdminKeysResponse200ItemsItemPermissionsAdminItem] | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        sessions: list[str] | Unset = UNSET
        if not isinstance(self.sessions, Unset):
            sessions = []
            for sessions_item_data in self.sessions:
                sessions_item: str = sessions_item_data
                sessions.append(sessions_item)

        tools: list[str] | Unset = UNSET
        if not isinstance(self.tools, Unset):
            tools = []
            for tools_item_data in self.tools:
                tools_item: str = tools_item_data
                tools.append(tools_item)

        admin: list[str] | Unset = UNSET
        if not isinstance(self.admin, Unset):
            admin = []
            for admin_item_data in self.admin:
                admin_item: str = admin_item_data
                admin.append(admin_item)

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if sessions is not UNSET:
            field_dict["sessions"] = sessions
        if tools is not UNSET:
            field_dict["tools"] = tools
        if admin is not UNSET:
            field_dict["admin"] = admin

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        _sessions = d.pop("sessions", UNSET)
        sessions: (
            list[GetAdminKeysResponse200ItemsItemPermissionsSessionsItem] | Unset
        ) = UNSET
        if _sessions is not UNSET:
            sessions = []
            for sessions_item_data in _sessions:
                sessions_item = check_get_admin_keys_response_200_items_item_permissions_sessions_item(
                    sessions_item_data
                )

                sessions.append(sessions_item)

        _tools = d.pop("tools", UNSET)
        tools: list[GetAdminKeysResponse200ItemsItemPermissionsToolsItem] | Unset = (
            UNSET
        )
        if _tools is not UNSET:
            tools = []
            for tools_item_data in _tools:
                tools_item = (
                    check_get_admin_keys_response_200_items_item_permissions_tools_item(
                        tools_item_data
                    )
                )

                tools.append(tools_item)

        _admin = d.pop("admin", UNSET)
        admin: list[GetAdminKeysResponse200ItemsItemPermissionsAdminItem] | Unset = (
            UNSET
        )
        if _admin is not UNSET:
            admin = []
            for admin_item_data in _admin:
                admin_item = (
                    check_get_admin_keys_response_200_items_item_permissions_admin_item(
                        admin_item_data
                    )
                )

                admin.append(admin_item)

        get_admin_keys_response_200_items_item_permissions = cls(
            sessions=sessions,
            tools=tools,
            admin=admin,
        )

        return get_admin_keys_response_200_items_item_permissions
