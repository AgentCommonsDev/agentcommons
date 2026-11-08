from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.post_admin_redaction_test_response_200_matches_item import (
        PostAdminRedactionTestResponse200MatchesItem,
    )


T = TypeVar("T", bound="PostAdminRedactionTestResponse200")


@_attrs_define
class PostAdminRedactionTestResponse200:
    """
    Attributes:
        text (str):
        matches (list[PostAdminRedactionTestResponse200MatchesItem]):
    """

    text: str
    matches: list[PostAdminRedactionTestResponse200MatchesItem]

    def to_dict(self) -> dict[str, Any]:
        text = self.text

        matches = []
        for matches_item_data in self.matches:
            matches_item = matches_item_data.to_dict()
            matches.append(matches_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "text": text,
                "matches": matches,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_admin_redaction_test_response_200_matches_item import (
            PostAdminRedactionTestResponse200MatchesItem,  # noqa: PLC0415
        )

        d = dict(src_dict)
        text = d.pop("text")

        matches = []
        _matches = d.pop("matches")
        for matches_item_data in _matches:
            matches_item = PostAdminRedactionTestResponse200MatchesItem.from_dict(
                matches_item_data
            )

            matches.append(matches_item)

        post_admin_redaction_test_response_200 = cls(
            text=text,
            matches=matches,
        )

        return post_admin_redaction_test_response_200
