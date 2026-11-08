from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="PostAdminSessionsIdPurgeResponse200ManifestDeleted")


@_attrs_define
class PostAdminSessionsIdPurgeResponse200ManifestDeleted:
    """
    Attributes:
        raw_records (int | None):
        messages (int | None):
        session_files (int | None):
        message_chunks (int | None):
        session_embeddings (int | None):
        redaction_events (int):
    """

    raw_records: int | None
    messages: int | None
    session_files: int | None
    message_chunks: int | None
    session_embeddings: int | None
    redaction_events: int

    def to_dict(self) -> dict[str, Any]:
        raw_records: int | None
        raw_records = self.raw_records

        messages: int | None
        messages = self.messages

        session_files: int | None
        session_files = self.session_files

        message_chunks: int | None
        message_chunks = self.message_chunks

        session_embeddings: int | None
        session_embeddings = self.session_embeddings

        redaction_events = self.redaction_events

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "raw_records": raw_records,
                "messages": messages,
                "session_files": session_files,
                "message_chunks": message_chunks,
                "session_embeddings": session_embeddings,
                "redaction_events": redaction_events,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)

        def _parse_raw_records(data: object) -> int | None:
            if data is None:
                return data
            return cast(int | None, data)

        raw_records = _parse_raw_records(d.pop("raw_records"))

        def _parse_messages(data: object) -> int | None:
            if data is None:
                return data
            return cast(int | None, data)

        messages = _parse_messages(d.pop("messages"))

        def _parse_session_files(data: object) -> int | None:
            if data is None:
                return data
            return cast(int | None, data)

        session_files = _parse_session_files(d.pop("session_files"))

        def _parse_message_chunks(data: object) -> int | None:
            if data is None:
                return data
            return cast(int | None, data)

        message_chunks = _parse_message_chunks(d.pop("message_chunks"))

        def _parse_session_embeddings(data: object) -> int | None:
            if data is None:
                return data
            return cast(int | None, data)

        session_embeddings = _parse_session_embeddings(d.pop("session_embeddings"))

        redaction_events = d.pop("redaction_events")

        post_admin_sessions_id_purge_response_200_manifest_deleted = cls(
            raw_records=raw_records,
            messages=messages,
            session_files=session_files,
            message_chunks=message_chunks,
            session_embeddings=session_embeddings,
            redaction_events=redaction_events,
        )

        return post_admin_sessions_id_purge_response_200_manifest_deleted
