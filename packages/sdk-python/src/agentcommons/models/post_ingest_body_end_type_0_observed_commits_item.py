from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="PostIngestBodyEndType0ObservedCommitsItem")


@_attrs_define
class PostIngestBodyEndType0ObservedCommitsItem:
    """
    Attributes:
        sha (str):
        subject (str):
        author (str):
        timestamp (datetime.datetime | None):
    """

    sha: str
    subject: str
    author: str
    timestamp: datetime.datetime | None

    def to_dict(self) -> dict[str, Any]:
        sha = self.sha

        subject = self.subject

        author = self.author

        timestamp: None | str
        if isinstance(self.timestamp, datetime.datetime):
            timestamp = self.timestamp.isoformat()
        else:
            timestamp = self.timestamp

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "sha": sha,
                "subject": subject,
                "author": author,
                "timestamp": timestamp,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        sha = d.pop("sha")

        subject = d.pop("subject")

        author = d.pop("author")

        def _parse_timestamp(data: object) -> datetime.datetime | None:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                timestamp_type_0 = datetime.datetime.fromisoformat(data)

                return timestamp_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None, data)

        timestamp = _parse_timestamp(d.pop("timestamp"))

        post_ingest_body_end_type_0_observed_commits_item = cls(
            sha=sha,
            subject=subject,
            author=author,
            timestamp=timestamp,
        )

        return post_ingest_body_end_type_0_observed_commits_item
