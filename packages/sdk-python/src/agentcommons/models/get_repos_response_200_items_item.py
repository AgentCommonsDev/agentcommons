from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="GetReposResponse200ItemsItem")


@_attrs_define
class GetReposResponse200ItemsItem:
    """
    Attributes:
        repo_name (str): Repository name; matches sessions.repo_name
        repo_url (None | str): Remote URL
        session_count (int): Sessions in the repository
        user_count (int): Distinct members who ran them
        first_seen_at (datetime.datetime): Earliest session start
        last_activity_at (datetime.datetime): Latest session activity
        truncated_fields (list[str]): Fields shortened to fit the response
    """

    repo_name: str
    repo_url: None | str
    session_count: int
    user_count: int
    first_seen_at: datetime.datetime
    last_activity_at: datetime.datetime
    truncated_fields: list[str]

    def to_dict(self) -> dict[str, Any]:
        repo_name = self.repo_name

        repo_url: None | str
        repo_url = self.repo_url

        session_count = self.session_count

        user_count = self.user_count

        first_seen_at = self.first_seen_at.isoformat()

        last_activity_at = self.last_activity_at.isoformat()

        truncated_fields = self.truncated_fields

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "repo_name": repo_name,
                "repo_url": repo_url,
                "session_count": session_count,
                "user_count": user_count,
                "first_seen_at": first_seen_at,
                "last_activity_at": last_activity_at,
                "truncated_fields": truncated_fields,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        repo_name = d.pop("repo_name")

        def _parse_repo_url(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        repo_url = _parse_repo_url(d.pop("repo_url"))

        session_count = d.pop("session_count")

        user_count = d.pop("user_count")

        first_seen_at = datetime.datetime.fromisoformat(d.pop("first_seen_at"))

        last_activity_at = datetime.datetime.fromisoformat(d.pop("last_activity_at"))

        truncated_fields = cast(list[str], d.pop("truncated_fields"))

        get_repos_response_200_items_item = cls(
            repo_name=repo_name,
            repo_url=repo_url,
            session_count=session_count,
            user_count=user_count,
            first_seen_at=first_seen_at,
            last_activity_at=last_activity_at,
            truncated_fields=truncated_fields,
        )

        return get_repos_response_200_items_item
