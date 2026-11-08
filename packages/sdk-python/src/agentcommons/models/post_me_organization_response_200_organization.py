from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.post_me_organization_response_200_organization_role import (
    PostMeOrganizationResponse200OrganizationRole,
    check_post_me_organization_response_200_organization_role,
)

T = TypeVar("T", bound="PostMeOrganizationResponse200Organization")


@_attrs_define
class PostMeOrganizationResponse200Organization:
    """
    Attributes:
        id (str):
        name (str):
        slug (str):
        role (PostMeOrganizationResponse200OrganizationRole):
    """

    id: str
    name: str
    slug: str
    role: PostMeOrganizationResponse200OrganizationRole

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        name = self.name

        slug = self.slug

        role: str = self.role

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "name": name,
                "slug": slug,
                "role": role,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        name = d.pop("name")

        slug = d.pop("slug")

        role = check_post_me_organization_response_200_organization_role(d.pop("role"))

        post_me_organization_response_200_organization = cls(
            id=id,
            name=name,
            slug=slug,
            role=role,
        )

        return post_me_organization_response_200_organization
