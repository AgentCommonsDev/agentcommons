from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="GetAdminInstallationsFilters")


@_attrs_define
class GetAdminInstallationsFilters:
    """
    Attributes:
        hostname (str | Unset): Machines whose hostname contains this text (ignoring case)
    """

    hostname: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        hostname = self.hostname

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if hostname is not UNSET:
            field_dict["hostname"] = hostname

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        hostname = d.pop("hostname", UNSET)

        get_admin_installations_filters = cls(
            hostname=hostname,
        )

        return get_admin_installations_filters
