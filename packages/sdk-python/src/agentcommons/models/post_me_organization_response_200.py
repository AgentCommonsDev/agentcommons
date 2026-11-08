from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.post_me_organization_response_200_organization import (
        PostMeOrganizationResponse200Organization,
    )


T = TypeVar("T", bound="PostMeOrganizationResponse200")


@_attrs_define
class PostMeOrganizationResponse200:
    """
    Attributes:
        organization (PostMeOrganizationResponse200Organization):
    """

    organization: PostMeOrganizationResponse200Organization

    def to_dict(self) -> dict[str, Any]:
        organization = self.organization.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "organization": organization,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_me_organization_response_200_organization import (
            PostMeOrganizationResponse200Organization,  # noqa: PLC0415
        )

        d = dict(src_dict)
        organization = PostMeOrganizationResponse200Organization.from_dict(
            d.pop("organization")
        )

        post_me_organization_response_200 = cls(
            organization=organization,
        )

        return post_me_organization_response_200
