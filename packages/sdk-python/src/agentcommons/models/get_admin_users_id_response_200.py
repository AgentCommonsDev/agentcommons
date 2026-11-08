from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.get_admin_users_id_response_200_role import (
    GetAdminUsersIdResponse200Role,
    check_get_admin_users_id_response_200_role,
)

T = TypeVar("T", bound="GetAdminUsersIdResponse200")


@_attrs_define
class GetAdminUsersIdResponse200:
    """
    Attributes:
        id (str):
        user_id (str):
        organization_id (str):
        email (str):
        name (str):
        role (GetAdminUsersIdResponse200Role):
        suspended (bool):
        created_at (datetime.datetime):
        last_seen_at (datetime.datetime | None):
    """

    id: str
    user_id: str
    organization_id: str
    email: str
    name: str
    role: GetAdminUsersIdResponse200Role
    suspended: bool
    created_at: datetime.datetime
    last_seen_at: datetime.datetime | None

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        user_id = self.user_id

        organization_id = self.organization_id

        email = self.email

        name = self.name

        role: str = self.role

        suspended = self.suspended

        created_at = self.created_at.isoformat()

        last_seen_at: None | str
        if isinstance(self.last_seen_at, datetime.datetime):
            last_seen_at = self.last_seen_at.isoformat()
        else:
            last_seen_at = self.last_seen_at

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "user_id": user_id,
                "organization_id": organization_id,
                "email": email,
                "name": name,
                "role": role,
                "suspended": suspended,
                "created_at": created_at,
                "last_seen_at": last_seen_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        user_id = d.pop("user_id")

        organization_id = d.pop("organization_id")

        email = d.pop("email")

        name = d.pop("name")

        role = check_get_admin_users_id_response_200_role(d.pop("role"))

        suspended = d.pop("suspended")

        created_at = datetime.datetime.fromisoformat(d.pop("created_at"))

        def _parse_last_seen_at(data: object) -> datetime.datetime | None:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                last_seen_at_type_0 = datetime.datetime.fromisoformat(data)

                return last_seen_at_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None, data)

        last_seen_at = _parse_last_seen_at(d.pop("last_seen_at"))

        get_admin_users_id_response_200 = cls(
            id=id,
            user_id=user_id,
            organization_id=organization_id,
            email=email,
            name=name,
            role=role,
            suspended=suspended,
            created_at=created_at,
            last_seen_at=last_seen_at,
        )

        return get_admin_users_id_response_200
