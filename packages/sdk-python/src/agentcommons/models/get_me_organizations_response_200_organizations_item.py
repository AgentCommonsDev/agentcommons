from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.get_me_organizations_response_200_organizations_item_role import (
    GetMeOrganizationsResponse200OrganizationsItemRole,
    check_get_me_organizations_response_200_organizations_item_role,
)

T = TypeVar("T", bound="GetMeOrganizationsResponse200OrganizationsItem")


@_attrs_define
class GetMeOrganizationsResponse200OrganizationsItem:
    """
    Attributes:
        id (str):
        name (str):
        slug (str):
        role (GetMeOrganizationsResponse200OrganizationsItemRole):
    """

    id: str
    name: str
    slug: str
    role: GetMeOrganizationsResponse200OrganizationsItemRole

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

        role = check_get_me_organizations_response_200_organizations_item_role(
            d.pop("role")
        )

        get_me_organizations_response_200_organizations_item = cls(
            id=id,
            name=name,
            slug=slug,
            role=role,
        )

        return get_me_organizations_response_200_organizations_item
