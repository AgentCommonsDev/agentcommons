from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="GetAdminDomainsResponse200ItemsItem")


@_attrs_define
class GetAdminDomainsResponse200ItemsItem:
    """
    Attributes:
        organization_id (str):
        domain (str):
        provider_id (str):
        verified (bool):
    """

    organization_id: str
    domain: str
    provider_id: str
    verified: bool

    def to_dict(self) -> dict[str, Any]:
        organization_id = self.organization_id

        domain = self.domain

        provider_id = self.provider_id

        verified = self.verified

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "organization_id": organization_id,
                "domain": domain,
                "provider_id": provider_id,
                "verified": verified,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        organization_id = d.pop("organization_id")

        domain = d.pop("domain")

        provider_id = d.pop("provider_id")

        verified = d.pop("verified")

        get_admin_domains_response_200_items_item = cls(
            organization_id=organization_id,
            domain=domain,
            provider_id=provider_id,
            verified=verified,
        )

        return get_admin_domains_response_200_items_item
