from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="PostAdminDomainsBody")


@_attrs_define
class PostAdminDomainsBody:
    """
    Attributes:
        domain (str):
    """

    domain: str

    def to_dict(self) -> dict[str, Any]:
        domain = self.domain

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "domain": domain,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        domain = d.pop("domain")

        post_admin_domains_body = cls(
            domain=domain,
        )

        return post_admin_domains_body
