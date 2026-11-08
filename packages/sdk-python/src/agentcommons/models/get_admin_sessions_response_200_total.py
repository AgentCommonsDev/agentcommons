from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="GetAdminSessionsResponse200Total")


@_attrs_define
class GetAdminSessionsResponse200Total:
    """Total over every matching session, computed with the same filters and roots_only as the page

    Attributes:
        sessions (int): Sessions the filters match across every page
    """

    sessions: int

    def to_dict(self) -> dict[str, Any]:
        sessions = self.sessions

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "sessions": sessions,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        sessions = d.pop("sessions")

        get_admin_sessions_response_200_total = cls(
            sessions=sessions,
        )

        return get_admin_sessions_response_200_total
