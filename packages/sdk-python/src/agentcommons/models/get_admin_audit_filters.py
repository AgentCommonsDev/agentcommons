from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.get_admin_audit_filters_transport import (
    GetAdminAuditFiltersTransport,
    check_get_admin_audit_filters_transport,
)
from ..types import UNSET, Unset

T = TypeVar("T", bound="GetAdminAuditFilters")


@_attrs_define
class GetAdminAuditFilters:
    """
    Attributes:
        user_id (str | Unset):
        user_email (str | Unset):
        api_key_id (str | Unset):
        request_id (str | Unset):
        resource_id (str | Unset):
        action (str | Unset):
        transport (GetAdminAuditFiltersTransport | Unset):
        status_code (int | Unset):
        since (datetime.datetime | Unset):
        until (datetime.datetime | Unset):
    """

    user_id: str | Unset = UNSET
    user_email: str | Unset = UNSET
    api_key_id: str | Unset = UNSET
    request_id: str | Unset = UNSET
    resource_id: str | Unset = UNSET
    action: str | Unset = UNSET
    transport: GetAdminAuditFiltersTransport | Unset = UNSET
    status_code: int | Unset = UNSET
    since: datetime.datetime | Unset = UNSET
    until: datetime.datetime | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        user_id = self.user_id

        user_email = self.user_email

        api_key_id = self.api_key_id

        request_id = self.request_id

        resource_id = self.resource_id

        action = self.action

        transport: str | Unset = UNSET
        if not isinstance(self.transport, Unset):
            transport = self.transport

        status_code = self.status_code

        since: str | Unset = UNSET
        if not isinstance(self.since, Unset):
            since = self.since.isoformat()

        until: str | Unset = UNSET
        if not isinstance(self.until, Unset):
            until = self.until.isoformat()

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if user_id is not UNSET:
            field_dict["user_id"] = user_id
        if user_email is not UNSET:
            field_dict["user_email"] = user_email
        if api_key_id is not UNSET:
            field_dict["api_key_id"] = api_key_id
        if request_id is not UNSET:
            field_dict["request_id"] = request_id
        if resource_id is not UNSET:
            field_dict["resource_id"] = resource_id
        if action is not UNSET:
            field_dict["action"] = action
        if transport is not UNSET:
            field_dict["transport"] = transport
        if status_code is not UNSET:
            field_dict["status_code"] = status_code
        if since is not UNSET:
            field_dict["since"] = since
        if until is not UNSET:
            field_dict["until"] = until

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        user_id = d.pop("user_id", UNSET)

        user_email = d.pop("user_email", UNSET)

        api_key_id = d.pop("api_key_id", UNSET)

        request_id = d.pop("request_id", UNSET)

        resource_id = d.pop("resource_id", UNSET)

        action = d.pop("action", UNSET)

        _transport = d.pop("transport", UNSET)
        transport: GetAdminAuditFiltersTransport | Unset
        if isinstance(_transport, Unset):
            transport = UNSET
        else:
            transport = check_get_admin_audit_filters_transport(_transport)

        status_code = d.pop("status_code", UNSET)

        _since = d.pop("since", UNSET)
        since: datetime.datetime | Unset
        if isinstance(_since, Unset):
            since = UNSET
        else:
            since = datetime.datetime.fromisoformat(_since)

        _until = d.pop("until", UNSET)
        until: datetime.datetime | Unset
        if isinstance(_until, Unset):
            until = UNSET
        else:
            until = datetime.datetime.fromisoformat(_until)

        get_admin_audit_filters = cls(
            user_id=user_id,
            user_email=user_email,
            api_key_id=api_key_id,
            request_id=request_id,
            resource_id=resource_id,
            action=action,
            transport=transport,
            status_code=status_code,
            since=since,
            until=until,
        )

        return get_admin_audit_filters
