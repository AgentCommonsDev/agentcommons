from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.post_admin_users_response_200_results_item import (
        PostAdminUsersResponse200ResultsItem,
    )


T = TypeVar("T", bound="PostAdminUsersResponse200")


@_attrs_define
class PostAdminUsersResponse200:
    """
    Attributes:
        results (list[PostAdminUsersResponse200ResultsItem]):
    """

    results: list[PostAdminUsersResponse200ResultsItem]

    def to_dict(self) -> dict[str, Any]:
        results = []
        for results_item_data in self.results:
            results_item = results_item_data.to_dict()
            results.append(results_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "results": results,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_admin_users_response_200_results_item import (
            PostAdminUsersResponse200ResultsItem,  # noqa: PLC0415
        )

        d = dict(src_dict)
        results = []
        _results = d.pop("results")
        for results_item_data in _results:
            results_item = PostAdminUsersResponse200ResultsItem.from_dict(
                results_item_data
            )

            results.append(results_item)

        post_admin_users_response_200 = cls(
            results=results,
        )

        return post_admin_users_response_200
