from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.get_sessions_id_similar_response_200_sessions_item import (
        GetSessionsIdSimilarResponse200SessionsItem,
    )


T = TypeVar("T", bound="GetSessionsIdSimilarResponse200")


@_attrs_define
class GetSessionsIdSimilarResponse200:
    """
    Attributes:
        sessions (list[GetSessionsIdSimilarResponse200SessionsItem]):
    """

    sessions: list[GetSessionsIdSimilarResponse200SessionsItem]

    def to_dict(self) -> dict[str, Any]:
        sessions = []
        for sessions_item_data in self.sessions:
            sessions_item = sessions_item_data.to_dict()
            sessions.append(sessions_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "sessions": sessions,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_sessions_id_similar_response_200_sessions_item import (
            GetSessionsIdSimilarResponse200SessionsItem,  # noqa: PLC0415
        )

        d = dict(src_dict)
        sessions = []
        _sessions = d.pop("sessions")
        for sessions_item_data in _sessions:
            sessions_item = GetSessionsIdSimilarResponse200SessionsItem.from_dict(
                sessions_item_data
            )

            sessions.append(sessions_item)

        get_sessions_id_similar_response_200 = cls(
            sessions=sessions,
        )

        return get_sessions_id_similar_response_200
