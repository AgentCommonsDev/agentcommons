from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="PutOrganizationSsoBody")


@_attrs_define
class PutOrganizationSsoBody:
    """
    Attributes:
        sso_only (bool):
    """

    sso_only: bool

    def to_dict(self) -> dict[str, Any]:
        sso_only = self.sso_only

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "sso_only": sso_only,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        sso_only = d.pop("sso_only")

        put_organization_sso_body = cls(
            sso_only=sso_only,
        )

        return put_organization_sso_body
