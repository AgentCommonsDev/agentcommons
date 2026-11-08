from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.get_admin_users_filters_role import (
    GetAdminUsersFiltersRole,
    check_get_admin_users_filters_role,
)
from ..types import UNSET, Unset

T = TypeVar("T", bound="GetAdminUsersFilters")


@_attrs_define
class GetAdminUsersFilters:
    """
    Attributes:
        email (str | Unset):
        role (GetAdminUsersFiltersRole | Unset):
        suspended (bool | Unset):
    """

    email: str | Unset = UNSET
    role: GetAdminUsersFiltersRole | Unset = UNSET
    suspended: bool | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        email = self.email

        role: str | Unset = UNSET
        if not isinstance(self.role, Unset):
            role = self.role

        suspended = self.suspended

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if email is not UNSET:
            field_dict["email"] = email
        if role is not UNSET:
            field_dict["role"] = role
        if suspended is not UNSET:
            field_dict["suspended"] = suspended

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        email = d.pop("email", UNSET)

        _role = d.pop("role", UNSET)
        role: GetAdminUsersFiltersRole | Unset
        if isinstance(_role, Unset):
            role = UNSET
        else:
            role = check_get_admin_users_filters_role(_role)

        suspended = d.pop("suspended", UNSET)

        get_admin_users_filters = cls(
            email=email,
            role=role,
            suspended=suspended,
        )

        return get_admin_users_filters
