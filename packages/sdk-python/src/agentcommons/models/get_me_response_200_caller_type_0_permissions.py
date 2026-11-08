from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.get_me_response_200_caller_type_0_permissions_admin_item import (
    GetMeResponse200CallerType0PermissionsAdminItem,
    check_get_me_response_200_caller_type_0_permissions_admin_item,
)
from ..models.get_me_response_200_caller_type_0_permissions_sessions_item import (
    GetMeResponse200CallerType0PermissionsSessionsItem,
    check_get_me_response_200_caller_type_0_permissions_sessions_item,
)
from ..models.get_me_response_200_caller_type_0_permissions_tools_item import (
    GetMeResponse200CallerType0PermissionsToolsItem,
    check_get_me_response_200_caller_type_0_permissions_tools_item,
)
from ..types import UNSET, Unset

T = TypeVar("T", bound="GetMeResponse200CallerType0Permissions")


@_attrs_define
class GetMeResponse200CallerType0Permissions:
    """
    Attributes:
        sessions (list[GetMeResponse200CallerType0PermissionsSessionsItem] | Unset):
        tools (list[GetMeResponse200CallerType0PermissionsToolsItem] | Unset):
        admin (list[GetMeResponse200CallerType0PermissionsAdminItem] | Unset):
    """

    sessions: list[GetMeResponse200CallerType0PermissionsSessionsItem] | Unset = UNSET
    tools: list[GetMeResponse200CallerType0PermissionsToolsItem] | Unset = UNSET
    admin: list[GetMeResponse200CallerType0PermissionsAdminItem] | Unset = UNSET

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
        sessions: list[GetMeResponse200CallerType0PermissionsSessionsItem] | Unset = (
            UNSET
        )
        if _sessions is not UNSET:
            sessions = []
            for sessions_item_data in _sessions:
                sessions_item = (
                    check_get_me_response_200_caller_type_0_permissions_sessions_item(
                        sessions_item_data
                    )
                )

                sessions.append(sessions_item)

        _tools = d.pop("tools", UNSET)
        tools: list[GetMeResponse200CallerType0PermissionsToolsItem] | Unset = UNSET
        if _tools is not UNSET:
            tools = []
            for tools_item_data in _tools:
                tools_item = (
                    check_get_me_response_200_caller_type_0_permissions_tools_item(
                        tools_item_data
                    )
                )

                tools.append(tools_item)

        _admin = d.pop("admin", UNSET)
        admin: list[GetMeResponse200CallerType0PermissionsAdminItem] | Unset = UNSET
        if _admin is not UNSET:
            admin = []
            for admin_item_data in _admin:
                admin_item = (
                    check_get_me_response_200_caller_type_0_permissions_admin_item(
                        admin_item_data
                    )
                )

                admin.append(admin_item)

        get_me_response_200_caller_type_0_permissions = cls(
            sessions=sessions,
            tools=tools,
            admin=admin,
        )

        return get_me_response_200_caller_type_0_permissions
