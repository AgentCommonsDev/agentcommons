from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define

from ..models.get_sessions_id_reuse_response_200_items_item_reader_harness import (
    GetSessionsIdReuseResponse200ItemsItemReaderHarness,
    check_get_sessions_id_reuse_response_200_items_item_reader_harness,
)

T = TypeVar("T", bound="GetSessionsIdReuseResponse200ItemsItem")


@_attrs_define
class GetSessionsIdReuseResponse200ItemsItem:
    """
    Attributes:
        source_session_id (UUID): Session that did the reading
        target_session_id (UUID): Session that was read
        source_title (None | str): Title of the reading session
        target_title (None | str): Title of the session that was read
        reader_user_id (str): Member who ran the reading session
        reader_email (str): Email of that member
        reader_harness (GetSessionsIdReuseResponse200ItemsItemReaderHarness): Harness of the reading session
        read_at (datetime.datetime): When the read happened
        audit_id (UUID): Audit event of the read
        truncated_fields (list[str]): Fields shortened to fit the response
    """

    source_session_id: UUID
    target_session_id: UUID
    source_title: None | str
    target_title: None | str
    reader_user_id: str
    reader_email: str
    reader_harness: GetSessionsIdReuseResponse200ItemsItemReaderHarness
    read_at: datetime.datetime
    audit_id: UUID
    truncated_fields: list[str]

    def to_dict(self) -> dict[str, Any]:
        source_session_id = str(self.source_session_id)

        target_session_id = str(self.target_session_id)

        source_title: None | str
        source_title = self.source_title

        target_title: None | str
        target_title = self.target_title

        reader_user_id = self.reader_user_id

        reader_email = self.reader_email

        reader_harness: str = self.reader_harness

        read_at = self.read_at.isoformat()

        audit_id = str(self.audit_id)

        truncated_fields = self.truncated_fields

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "source_session_id": source_session_id,
                "target_session_id": target_session_id,
                "source_title": source_title,
                "target_title": target_title,
                "reader_user_id": reader_user_id,
                "reader_email": reader_email,
                "reader_harness": reader_harness,
                "read_at": read_at,
                "audit_id": audit_id,
                "truncated_fields": truncated_fields,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        source_session_id = UUID(d.pop("source_session_id"))

        target_session_id = UUID(d.pop("target_session_id"))

        def _parse_source_title(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        source_title = _parse_source_title(d.pop("source_title"))

        def _parse_target_title(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        target_title = _parse_target_title(d.pop("target_title"))

        reader_user_id = d.pop("reader_user_id")

        reader_email = d.pop("reader_email")

        reader_harness = (
            check_get_sessions_id_reuse_response_200_items_item_reader_harness(
                d.pop("reader_harness")
            )
        )

        read_at = datetime.datetime.fromisoformat(d.pop("read_at"))

        audit_id = UUID(d.pop("audit_id"))

        truncated_fields = cast(list[str], d.pop("truncated_fields"))

        get_sessions_id_reuse_response_200_items_item = cls(
            source_session_id=source_session_id,
            target_session_id=target_session_id,
            source_title=source_title,
            target_title=target_title,
            reader_user_id=reader_user_id,
            reader_email=reader_email,
            reader_harness=reader_harness,
            read_at=read_at,
            audit_id=audit_id,
            truncated_fields=truncated_fields,
        )

        return get_sessions_id_reuse_response_200_items_item
