from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.patch_admin_users_id_role_body_role import (
    PatchAdminUsersIdRoleBodyRole,
    check_patch_admin_users_id_role_body_role,
)

T = TypeVar("T", bound="PatchAdminUsersIdRoleBody")


@_attrs_define
class PatchAdminUsersIdRoleBody:
    """
    Attributes:
        role (PatchAdminUsersIdRoleBodyRole):
        reason (str):
    """

    role: PatchAdminUsersIdRoleBodyRole
    reason: str

    def to_dict(self) -> dict[str, Any]:
        role: str = self.role

        reason = self.reason

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "role": role,
                "reason": reason,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        role = check_patch_admin_users_id_role_body_role(d.pop("role"))

        reason = d.pop("reason")

        patch_admin_users_id_role_body = cls(
            role=role,
            reason=reason,
        )

        return patch_admin_users_id_role_body
