from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="GetAdminInstallationsResponse200Total")


@_attrs_define
class GetAdminInstallationsResponse200Total:
    """Freshness counts over every matching installation, unchanged by the page window

    Attributes:
        installations (int): Installations the filters match across every page
        up_to_date (int): Installations whose hook digest matches the served bundle
        behind (int): Installations reporting an older hook digest
        unknown (int): Installations with no reported digest, or every installation when no bundle is served
    """

    installations: int
    up_to_date: int
    behind: int
    unknown: int

    def to_dict(self) -> dict[str, Any]:
        installations = self.installations

        up_to_date = self.up_to_date

        behind = self.behind

        unknown = self.unknown

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "installations": installations,
                "up_to_date": up_to_date,
                "behind": behind,
                "unknown": unknown,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        installations = d.pop("installations")

        up_to_date = d.pop("up_to_date")

        behind = d.pop("behind")

        unknown = d.pop("unknown")

        get_admin_installations_response_200_total = cls(
            installations=installations,
            up_to_date=up_to_date,
            behind=behind,
            unknown=unknown,
        )

        return get_admin_installations_response_200_total
