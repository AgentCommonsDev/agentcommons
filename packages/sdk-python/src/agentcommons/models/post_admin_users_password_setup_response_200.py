from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="PostAdminUsersPasswordSetupResponse200")


@_attrs_define
class PostAdminUsersPasswordSetupResponse200:
    """
    Attributes:
        setup_url (str):
        expires_at (datetime.datetime):
    """

    setup_url: str
    expires_at: datetime.datetime

    def to_dict(self) -> dict[str, Any]:
        setup_url = self.setup_url

        expires_at = self.expires_at.isoformat()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "setup_url": setup_url,
                "expires_at": expires_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        setup_url = d.pop("setup_url")

        expires_at = datetime.datetime.fromisoformat(d.pop("expires_at"))

        post_admin_users_password_setup_response_200 = cls(
            setup_url=setup_url,
            expires_at=expires_at,
        )

        return post_admin_users_password_setup_response_200
