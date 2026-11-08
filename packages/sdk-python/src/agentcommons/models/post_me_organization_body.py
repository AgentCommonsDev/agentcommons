from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="PostMeOrganizationBody")


@_attrs_define
class PostMeOrganizationBody:
    """
    Attributes:
        organization_id (str):
    """

    organization_id: str

    def to_dict(self) -> dict[str, Any]:
        organization_id = self.organization_id

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "organization_id": organization_id,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        organization_id = d.pop("organization_id")

        post_me_organization_body = cls(
            organization_id=organization_id,
        )

        return post_me_organization_body
