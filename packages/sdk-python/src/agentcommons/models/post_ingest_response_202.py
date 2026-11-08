from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar
from uuid import UUID

from attrs import define as _attrs_define

from ..models.post_ingest_response_202_publication import (
    PostIngestResponse202Publication,
    check_post_ingest_response_202_publication,
)

T = TypeVar("T", bound="PostIngestResponse202")


@_attrs_define
class PostIngestResponse202:
    """
    Attributes:
        publication (PostIngestResponse202Publication):
        session_id (UUID):
        accepted (int):
        duplicates (int):
        cursor (str):
    """

    publication: PostIngestResponse202Publication
    session_id: UUID
    accepted: int
    duplicates: int
    cursor: str

    def to_dict(self) -> dict[str, Any]:
        publication: str = self.publication

        session_id = str(self.session_id)

        accepted = self.accepted

        duplicates = self.duplicates

        cursor = self.cursor

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "publication": publication,
                "sessionId": session_id,
                "accepted": accepted,
                "duplicates": duplicates,
                "cursor": cursor,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        publication = check_post_ingest_response_202_publication(d.pop("publication"))

        session_id = UUID(d.pop("sessionId"))

        accepted = d.pop("accepted")

        duplicates = d.pop("duplicates")

        cursor = d.pop("cursor")

        post_ingest_response_202 = cls(
            publication=publication,
            session_id=session_id,
            accepted=accepted,
            duplicates=duplicates,
            cursor=cursor,
        )

        return post_ingest_response_202
