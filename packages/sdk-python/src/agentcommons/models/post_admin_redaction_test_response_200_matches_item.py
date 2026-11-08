from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="PostAdminRedactionTestResponse200MatchesItem")


@_attrs_define
class PostAdminRedactionTestResponse200MatchesItem:
    """
    Attributes:
        policy_id (str):
        count (int):
    """

    policy_id: str
    count: int

    def to_dict(self) -> dict[str, Any]:
        policy_id = self.policy_id

        count = self.count

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "policy_id": policy_id,
                "count": count,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        policy_id = d.pop("policy_id")

        count = d.pop("count")

        post_admin_redaction_test_response_200_matches_item = cls(
            policy_id=policy_id,
            count=count,
        )

        return post_admin_redaction_test_response_200_matches_item
