from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_me_keys_body_permissions import PostMeKeysBodyPermissions


T = TypeVar("T", bound="PostMeKeysBody")


@_attrs_define
class PostMeKeysBody:
    """
    Attributes:
        name (str):
        permissions (PostMeKeysBodyPermissions):
        expires_in (int | Unset):
    """

    name: str
    permissions: PostMeKeysBodyPermissions
    expires_in: int | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        permissions = self.permissions.to_dict()

        expires_in = self.expires_in

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "name": name,
                "permissions": permissions,
            }
        )
        if expires_in is not UNSET:
            field_dict["expires_in"] = expires_in

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_me_keys_body_permissions import (
            PostMeKeysBodyPermissions,  # noqa: PLC0415
        )

        d = dict(src_dict)
        name = d.pop("name")

        permissions = PostMeKeysBodyPermissions.from_dict(d.pop("permissions"))

        expires_in = d.pop("expires_in", UNSET)

        post_me_keys_body = cls(
            name=name,
            permissions=permissions,
            expires_in=expires_in,
        )

        return post_me_keys_body
