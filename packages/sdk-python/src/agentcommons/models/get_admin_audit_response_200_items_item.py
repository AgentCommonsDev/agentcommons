from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define

from ..models.get_admin_audit_response_200_items_item_transport import (
    GetAdminAuditResponse200ItemsItemTransport,
    check_get_admin_audit_response_200_items_item_transport,
)

T = TypeVar("T", bound="GetAdminAuditResponse200ItemsItem")


@_attrs_define
class GetAdminAuditResponse200ItemsItem:
    """
    Attributes:
        id (UUID):
        organization_id (str):
        ts (datetime.datetime):
        request_id (str):
        user_id (None | str):
        user_email (None | str):
        api_key_id (None | str):
        installation_id (None | UUID):
        auth_method (str):
        ip (str):
        user_agent (None | str):
        transport (GetAdminAuditResponse200ItemsItemTransport):
        action (str):
        resource_type (None | str):
        resource_ids (list[str]):
        status_code (int):
        duration_ms (int):
        detail (Any):
    """

    id: UUID
    organization_id: str
    ts: datetime.datetime
    request_id: str
    user_id: None | str
    user_email: None | str
    api_key_id: None | str
    installation_id: None | UUID
    auth_method: str
    ip: str
    user_agent: None | str
    transport: GetAdminAuditResponse200ItemsItemTransport
    action: str
    resource_type: None | str
    resource_ids: list[str]
    status_code: int
    duration_ms: int
    detail: Any

    def to_dict(self) -> dict[str, Any]:
        id = str(self.id)

        organization_id = self.organization_id

        ts = self.ts.isoformat()

        request_id = self.request_id

        user_id: None | str
        user_id = self.user_id

        user_email: None | str
        user_email = self.user_email

        api_key_id: None | str
        api_key_id = self.api_key_id

        installation_id: None | str
        if isinstance(self.installation_id, UUID):
            installation_id = str(self.installation_id)
        else:
            installation_id = self.installation_id

        auth_method = self.auth_method

        ip = self.ip

        user_agent: None | str
        user_agent = self.user_agent

        transport: str = self.transport

        action = self.action

        resource_type: None | str
        resource_type = self.resource_type

        resource_ids = self.resource_ids

        status_code = self.status_code

        duration_ms = self.duration_ms

        detail = self.detail

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "organization_id": organization_id,
                "ts": ts,
                "request_id": request_id,
                "user_id": user_id,
                "user_email": user_email,
                "api_key_id": api_key_id,
                "installation_id": installation_id,
                "auth_method": auth_method,
                "ip": ip,
                "user_agent": user_agent,
                "transport": transport,
                "action": action,
                "resource_type": resource_type,
                "resource_ids": resource_ids,
                "status_code": status_code,
                "duration_ms": duration_ms,
                "detail": detail,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = UUID(d.pop("id"))

        organization_id = d.pop("organization_id")

        ts = datetime.datetime.fromisoformat(d.pop("ts"))

        request_id = d.pop("request_id")

        def _parse_user_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        user_id = _parse_user_id(d.pop("user_id"))

        def _parse_user_email(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        user_email = _parse_user_email(d.pop("user_email"))

        def _parse_api_key_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        api_key_id = _parse_api_key_id(d.pop("api_key_id"))

        def _parse_installation_id(data: object) -> None | UUID:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                installation_id_type_0 = UUID(data)

                return installation_id_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | UUID, data)

        installation_id = _parse_installation_id(d.pop("installation_id"))

        auth_method = d.pop("auth_method")

        ip = d.pop("ip")

        def _parse_user_agent(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        user_agent = _parse_user_agent(d.pop("user_agent"))

        transport = check_get_admin_audit_response_200_items_item_transport(
            d.pop("transport")
        )

        action = d.pop("action")

        def _parse_resource_type(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        resource_type = _parse_resource_type(d.pop("resource_type"))

        resource_ids = cast(list[str], d.pop("resource_ids"))

        status_code = d.pop("status_code")

        duration_ms = d.pop("duration_ms")

        detail = d.pop("detail")

        get_admin_audit_response_200_items_item = cls(
            id=id,
            organization_id=organization_id,
            ts=ts,
            request_id=request_id,
            user_id=user_id,
            user_email=user_email,
            api_key_id=api_key_id,
            installation_id=installation_id,
            auth_method=auth_method,
            ip=ip,
            user_agent=user_agent,
            transport=transport,
            action=action,
            resource_type=resource_type,
            resource_ids=resource_ids,
            status_code=status_code,
            duration_ms=duration_ms,
            detail=detail,
        )

        return get_admin_audit_response_200_items_item
