from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="GetReposFilters")


@_attrs_define
class GetReposFilters:
    """
    Attributes:
        repo_name (str | Unset):
    """

    repo_name: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        repo_name = self.repo_name

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if repo_name is not UNSET:
            field_dict["repo_name"] = repo_name

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        repo_name = d.pop("repo_name", UNSET)

        get_repos_filters = cls(
            repo_name=repo_name,
        )

        return get_repos_filters
