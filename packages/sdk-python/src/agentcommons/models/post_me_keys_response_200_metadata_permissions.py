from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.post_me_keys_response_200_metadata_permissions_admin_item import (
    PostMeKeysResponse200MetadataPermissionsAdminItem,
    check_post_me_keys_response_200_metadata_permissions_admin_item,
)
from ..models.post_me_keys_response_200_metadata_permissions_sessions_item import (
    PostMeKeysResponse200MetadataPermissionsSessionsItem,
    check_post_me_keys_response_200_metadata_permissions_sessions_item,
)
from ..models.post_me_keys_response_200_metadata_permissions_tools_item import (
    PostMeKeysResponse200MetadataPermissionsToolsItem,
    check_post_me_keys_response_200_metadata_permissions_tools_item,
)
from ..types import UNSET, Unset

T = TypeVar("T", bound="PostMeKeysResponse200MetadataPermissions")


@_attrs_define
class PostMeKeysResponse200MetadataPermissions:
    """
    Attributes:
        sessions (list[PostMeKeysResponse200MetadataPermissionsSessionsItem] | Unset):
        tools (list[PostMeKeysResponse200MetadataPermissionsToolsItem] | Unset):
        admin (list[PostMeKeysResponse200MetadataPermissionsAdminItem] | Unset):
    """

    sessions: list[PostMeKeysResponse200MetadataPermissionsSessionsItem] | Unset = UNSET
    tools: list[PostMeKeysResponse200MetadataPermissionsToolsItem] | Unset = UNSET
    admin: list[PostMeKeysResponse200MetadataPermissionsAdminItem] | Unset = UNSET

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
        sessions: list[PostMeKeysResponse200MetadataPermissionsSessionsItem] | Unset = (
            UNSET
        )
        if _sessions is not UNSET:
            sessions = []
            for sessions_item_data in _sessions:
                sessions_item = (
                    check_post_me_keys_response_200_metadata_permissions_sessions_item(
                        sessions_item_data
                    )
                )

                sessions.append(sessions_item)

        _tools = d.pop("tools", UNSET)
        tools: list[PostMeKeysResponse200MetadataPermissionsToolsItem] | Unset = UNSET
        if _tools is not UNSET:
            tools = []
            for tools_item_data in _tools:
                tools_item = (
                    check_post_me_keys_response_200_metadata_permissions_tools_item(
                        tools_item_data
                    )
                )

                tools.append(tools_item)

        _admin = d.pop("admin", UNSET)
        admin: list[PostMeKeysResponse200MetadataPermissionsAdminItem] | Unset = UNSET
        if _admin is not UNSET:
            admin = []
            for admin_item_data in _admin:
                admin_item = (
                    check_post_me_keys_response_200_metadata_permissions_admin_item(
                        admin_item_data
                    )
                )

                admin.append(admin_item)

        post_me_keys_response_200_metadata_permissions = cls(
            sessions=sessions,
            tools=tools,
            admin=admin,
        )

        return post_me_keys_response_200_metadata_permissions
