from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define

from ..models.get_me_response_200_caller_type_0_auth_method import (
    GetMeResponse200CallerType0AuthMethod,
    check_get_me_response_200_caller_type_0_auth_method,
)
from ..models.get_me_response_200_caller_type_0_role import (
    GetMeResponse200CallerType0Role,
    check_get_me_response_200_caller_type_0_role,
)
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.get_me_response_200_caller_type_0_permissions import (
        GetMeResponse200CallerType0Permissions,
    )


T = TypeVar("T", bound="GetMeResponse200CallerType0")


@_attrs_define
class GetMeResponse200CallerType0:
    """
    Attributes:
        organization_id (str):
        user_id (str):
        role (GetMeResponse200CallerType0Role):
        api_key_id (None | str):
        auth_method (GetMeResponse200CallerType0AuthMethod):
        permissions (GetMeResponse200CallerType0Permissions):
        installation_id (None | Unset | UUID):
        tools_enabled (bool | Unset):
    """

    organization_id: str
    user_id: str
    role: GetMeResponse200CallerType0Role
    api_key_id: None | str
    auth_method: GetMeResponse200CallerType0AuthMethod
    permissions: GetMeResponse200CallerType0Permissions
    installation_id: None | Unset | UUID = UNSET
    tools_enabled: bool | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        organization_id = self.organization_id

        user_id = self.user_id

        role: str = self.role

        api_key_id: None | str
        api_key_id = self.api_key_id

        auth_method: str = self.auth_method

        permissions = self.permissions.to_dict()

        installation_id: None | str | Unset
        if isinstance(self.installation_id, Unset):
            installation_id = UNSET
        elif isinstance(self.installation_id, UUID):
            installation_id = str(self.installation_id)
        else:
            installation_id = self.installation_id

        tools_enabled = self.tools_enabled

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "organizationId": organization_id,
                "userId": user_id,
                "role": role,
                "apiKeyId": api_key_id,
                "authMethod": auth_method,
                "permissions": permissions,
            }
        )
        if installation_id is not UNSET:
            field_dict["installationId"] = installation_id
        if tools_enabled is not UNSET:
            field_dict["toolsEnabled"] = tools_enabled

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_me_response_200_caller_type_0_permissions import (
            GetMeResponse200CallerType0Permissions,  # noqa: PLC0415
        )

        d = dict(src_dict)
        organization_id = d.pop("organizationId")

        user_id = d.pop("userId")

        role = check_get_me_response_200_caller_type_0_role(d.pop("role"))

        def _parse_api_key_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        api_key_id = _parse_api_key_id(d.pop("apiKeyId"))

        auth_method = check_get_me_response_200_caller_type_0_auth_method(
            d.pop("authMethod")
        )

        permissions = GetMeResponse200CallerType0Permissions.from_dict(
            d.pop("permissions")
        )

        def _parse_installation_id(data: object) -> None | Unset | UUID:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                installation_id_type_0 = UUID(data)

                return installation_id_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | Unset | UUID, data)

        installation_id = _parse_installation_id(d.pop("installationId", UNSET))

        tools_enabled = d.pop("toolsEnabled", UNSET)

        get_me_response_200_caller_type_0 = cls(
            organization_id=organization_id,
            user_id=user_id,
            role=role,
            api_key_id=api_key_id,
            auth_method=auth_method,
            permissions=permissions,
            installation_id=installation_id,
            tools_enabled=tools_enabled,
        )

        return get_me_response_200_caller_type_0
