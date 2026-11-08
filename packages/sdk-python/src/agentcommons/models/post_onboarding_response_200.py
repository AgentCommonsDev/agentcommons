from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="PostOnboardingResponse200")


@_attrs_define
class PostOnboardingResponse200:
    """
    Attributes:
        organization_id (str):
        created (bool):
    """

    organization_id: str
    created: bool

    def to_dict(self) -> dict[str, Any]:
        organization_id = self.organization_id

        created = self.created

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "organization_id": organization_id,
                "created": created,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        organization_id = d.pop("organization_id")

        created = d.pop("created")

        post_onboarding_response_200 = cls(
            organization_id=organization_id,
            created=created,
        )

        return post_onboarding_response_200
