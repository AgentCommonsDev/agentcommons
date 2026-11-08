from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="PutOrganizationSsoResponse200")


@_attrs_define
class PutOrganizationSsoResponse200:
    """
    Attributes:
        sso_only (bool):
        revision (int):
    """

    sso_only: bool
    revision: int

    def to_dict(self) -> dict[str, Any]:
        sso_only = self.sso_only

        revision = self.revision

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "sso_only": sso_only,
                "revision": revision,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        sso_only = d.pop("sso_only")

        revision = d.pop("revision")

        put_organization_sso_response_200 = cls(
            sso_only=sso_only,
            revision=revision,
        )

        return put_organization_sso_response_200
