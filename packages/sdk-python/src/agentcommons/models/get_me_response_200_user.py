from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="GetMeResponse200User")


@_attrs_define
class GetMeResponse200User:
    """
    Attributes:
        id (str):
        email (str):
        name (str):
        email_verified (bool):
    """

    id: str
    email: str
    name: str
    email_verified: bool

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        email = self.email

        name = self.name

        email_verified = self.email_verified

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "email": email,
                "name": name,
                "email_verified": email_verified,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        email = d.pop("email")

        name = d.pop("name")

        email_verified = d.pop("email_verified")

        get_me_response_200_user = cls(
            id=id,
            email=email,
            name=name,
            email_verified=email_verified,
        )

        return get_me_response_200_user
