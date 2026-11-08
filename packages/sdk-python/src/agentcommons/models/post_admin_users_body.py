from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.post_admin_users_body_role import (
    PostAdminUsersBodyRole,
    check_post_admin_users_body_role,
)

T = TypeVar("T", bound="PostAdminUsersBody")


@_attrs_define
class PostAdminUsersBody:
    """
    Attributes:
        emails (list[str]):
        role (PostAdminUsersBodyRole):
    """

    emails: list[str]
    role: PostAdminUsersBodyRole

    def to_dict(self) -> dict[str, Any]:
        emails = self.emails

        role: str = self.role

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "emails": emails,
                "role": role,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        emails = cast(list[str], d.pop("emails"))

        role = check_post_admin_users_body_role(d.pop("role"))

        post_admin_users_body = cls(
            emails=emails,
            role=role,
        )

        return post_admin_users_body
