from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.get_me_organizations_response_200_organizations_item import (
        GetMeOrganizationsResponse200OrganizationsItem,
    )


T = TypeVar("T", bound="GetMeOrganizationsResponse200")


@_attrs_define
class GetMeOrganizationsResponse200:
    """
    Attributes:
        organizations (list[GetMeOrganizationsResponse200OrganizationsItem]):
        active_organization_id (None | str):
    """

    organizations: list[GetMeOrganizationsResponse200OrganizationsItem]
    active_organization_id: None | str

    def to_dict(self) -> dict[str, Any]:
        organizations = []
        for organizations_item_data in self.organizations:
            organizations_item = organizations_item_data.to_dict()
            organizations.append(organizations_item)

        active_organization_id: None | str
        active_organization_id = self.active_organization_id

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "organizations": organizations,
                "active_organization_id": active_organization_id,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_me_organizations_response_200_organizations_item import (
            GetMeOrganizationsResponse200OrganizationsItem,  # noqa: PLC0415
        )

        d = dict(src_dict)
        organizations = []
        _organizations = d.pop("organizations")
        for organizations_item_data in _organizations:
            organizations_item = (
                GetMeOrganizationsResponse200OrganizationsItem.from_dict(
                    organizations_item_data
                )
            )

            organizations.append(organizations_item)

        def _parse_active_organization_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        active_organization_id = _parse_active_organization_id(
            d.pop("active_organization_id")
        )

        get_me_organizations_response_200 = cls(
            organizations=organizations,
            active_organization_id=active_organization_id,
        )

        return get_me_organizations_response_200
