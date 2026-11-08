from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="GetSessionsResponse200Total")


@_attrs_define
class GetSessionsResponse200Total:
    """Totals over every matching session, computed with the same filters and roots_only as the page

    Attributes:
        sessions (int): Sessions the filters match under the caller's visibility, across every page
        messages (int): Sum of message_count over those sessions
    """

    sessions: int
    messages: int

    def to_dict(self) -> dict[str, Any]:
        sessions = self.sessions

        messages = self.messages

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "sessions": sessions,
                "messages": messages,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        sessions = d.pop("sessions")

        messages = d.pop("messages")

        get_sessions_response_200_total = cls(
            sessions=sessions,
            messages=messages,
        )

        return get_sessions_response_200_total
