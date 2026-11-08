from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="PostSearchResponse200PartialType0")


@_attrs_define
class PostSearchResponse200PartialType0:
    """
    Attributes:
        sessions_searched (int): How many of the most recently active matching sessions this bounded page searched
    """

    sessions_searched: int

    def to_dict(self) -> dict[str, Any]:
        sessions_searched = self.sessions_searched

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "sessions_searched": sessions_searched,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        sessions_searched = d.pop("sessions_searched")

        post_search_response_200_partial_type_0 = cls(
            sessions_searched=sessions_searched,
        )

        return post_search_response_200_partial_type_0
