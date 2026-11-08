from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="PostSearchResponse200Total")


@_attrs_define
class PostSearchResponse200Total:
    """Totals over every hit the query and filters match under the caller's visibility, not only this page

    Attributes:
        sessions (int): Distinct sessions with at least one matching message, across every page
        hits (int): Matching messages before the per-session cap and paging
    """

    sessions: int
    hits: int

    def to_dict(self) -> dict[str, Any]:
        sessions = self.sessions

        hits = self.hits

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "sessions": sessions,
                "hits": hits,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        sessions = d.pop("sessions")

        hits = d.pop("hits")

        post_search_response_200_total = cls(
            sessions=sessions,
            hits=hits,
        )

        return post_search_response_200_total
