from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="PatchAdminUsersIdSuspensionBody")


@_attrs_define
class PatchAdminUsersIdSuspensionBody:
    """
    Attributes:
        suspended (bool):
        reason (str):
    """

    suspended: bool
    reason: str

    def to_dict(self) -> dict[str, Any]:
        suspended = self.suspended

        reason = self.reason

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "suspended": suspended,
                "reason": reason,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        suspended = d.pop("suspended")

        reason = d.pop("reason")

        patch_admin_users_id_suspension_body = cls(
            suspended=suspended,
            reason=reason,
        )

        return patch_admin_users_id_suspension_body
