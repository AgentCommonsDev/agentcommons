from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define

from ..models.get_sessions_id_response_200_messages_item_kind import (
    GetSessionsIdResponse200MessagesItemKind,
    check_get_sessions_id_response_200_messages_item_kind,
)
from ..models.get_sessions_id_response_200_messages_item_role import (
    GetSessionsIdResponse200MessagesItemRole,
    check_get_sessions_id_response_200_messages_item_role,
)

if TYPE_CHECKING:
    from ..models.get_sessions_id_response_200_messages_item_content_cursor_type_0 import (
        GetSessionsIdResponse200MessagesItemContentCursorType0,
    )


T = TypeVar("T", bound="GetSessionsIdResponse200MessagesItem")


@_attrs_define
class GetSessionsIdResponse200MessagesItem:
    """
    Attributes:
        message_id (UUID): Primary key of the block
        session_id (UUID): Session; joins sessions.session_id
        raw_record_id (None | UUID): Raw harness record the block came from
        ingest_batch_id (None | UUID): Upload batch that delivered it
        seq (int): Position of the block within the session, ascending; counts every kind, so a read that leaves META
            out shows gaps
        role (GetSessionsIdResponse200MessagesItemRole): USER, ASSISTANT, TOOL_RESULT or SYSTEM
        kind (GetSessionsIdResponse200MessagesItemKind): TEXT, THINKING, TOOL_USE, TOOL_RESULT or META
        content (str): Redacted text of the block; tool results and metadata are stored as text
        content_cursor (GetSessionsIdResponse200MessagesItemContentCursorType0 | None): Set when this message's content
            is bounded here; to read the rest, call get with from and to set to this seq and cursor set to this value
        tool_name (None | str): Tool called or answered, for TOOL_USE and TOOL_RESULT
        tool_use_id (None | str): Harness id pairing a tool call with its result
        model (None | str): Model that produced the block
        timestamp (datetime.datetime | None): When the harness recorded the block
        received_at (datetime.datetime): When the server received it
        input_tokens (None | str): Input tokens reported for the block
        output_tokens (None | str): Output tokens reported for the block
        agent_id (None | str): Subagent id when a subagent produced the block
        truncated_fields (list[str]): Fields shortened to fit the response
    """

    message_id: UUID
    session_id: UUID
    raw_record_id: None | UUID
    ingest_batch_id: None | UUID
    seq: int
    role: GetSessionsIdResponse200MessagesItemRole
    kind: GetSessionsIdResponse200MessagesItemKind
    content: str
    content_cursor: GetSessionsIdResponse200MessagesItemContentCursorType0 | None
    tool_name: None | str
    tool_use_id: None | str
    model: None | str
    timestamp: datetime.datetime | None
    received_at: datetime.datetime
    input_tokens: None | str
    output_tokens: None | str
    agent_id: None | str
    truncated_fields: list[str]

    def to_dict(self) -> dict[str, Any]:
        from ..models.get_sessions_id_response_200_messages_item_content_cursor_type_0 import (
            GetSessionsIdResponse200MessagesItemContentCursorType0,  # noqa: PLC0415
        )

        message_id = str(self.message_id)

        session_id = str(self.session_id)

        raw_record_id: None | str
        if isinstance(self.raw_record_id, UUID):
            raw_record_id = str(self.raw_record_id)
        else:
            raw_record_id = self.raw_record_id

        ingest_batch_id: None | str
        if isinstance(self.ingest_batch_id, UUID):
            ingest_batch_id = str(self.ingest_batch_id)
        else:
            ingest_batch_id = self.ingest_batch_id

        seq = self.seq

        role: str = self.role

        kind: str = self.kind

        content = self.content

        content_cursor: dict[str, Any] | None
        if isinstance(
            self.content_cursor, GetSessionsIdResponse200MessagesItemContentCursorType0
        ):
            content_cursor = self.content_cursor.to_dict()
        else:
            content_cursor = self.content_cursor

        tool_name: None | str
        tool_name = self.tool_name

        tool_use_id: None | str
        tool_use_id = self.tool_use_id

        model: None | str
        model = self.model

        timestamp: None | str
        if isinstance(self.timestamp, datetime.datetime):
            timestamp = self.timestamp.isoformat()
        else:
            timestamp = self.timestamp

        received_at = self.received_at.isoformat()

        input_tokens: None | str
        input_tokens = self.input_tokens

        output_tokens: None | str
        output_tokens = self.output_tokens

        agent_id: None | str
        agent_id = self.agent_id

        truncated_fields = self.truncated_fields

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "message_id": message_id,
                "session_id": session_id,
                "raw_record_id": raw_record_id,
                "ingest_batch_id": ingest_batch_id,
                "seq": seq,
                "role": role,
                "kind": kind,
                "content": content,
                "content_cursor": content_cursor,
                "tool_name": tool_name,
                "tool_use_id": tool_use_id,
                "model": model,
                "timestamp": timestamp,
                "received_at": received_at,
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "agent_id": agent_id,
                "truncated_fields": truncated_fields,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_sessions_id_response_200_messages_item_content_cursor_type_0 import (
            GetSessionsIdResponse200MessagesItemContentCursorType0,  # noqa: PLC0415
        )

        d = dict(src_dict)
        message_id = UUID(d.pop("message_id"))

        session_id = UUID(d.pop("session_id"))

        def _parse_raw_record_id(data: object) -> None | UUID:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                raw_record_id_type_0 = UUID(data)

                return raw_record_id_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | UUID, data)

        raw_record_id = _parse_raw_record_id(d.pop("raw_record_id"))

        def _parse_ingest_batch_id(data: object) -> None | UUID:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                ingest_batch_id_type_0 = UUID(data)

                return ingest_batch_id_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | UUID, data)

        ingest_batch_id = _parse_ingest_batch_id(d.pop("ingest_batch_id"))

        seq = d.pop("seq")

        role = check_get_sessions_id_response_200_messages_item_role(d.pop("role"))

        kind = check_get_sessions_id_response_200_messages_item_kind(d.pop("kind"))

        content = d.pop("content")

        def _parse_content_cursor(
            data: object,
        ) -> GetSessionsIdResponse200MessagesItemContentCursorType0 | None:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                content_cursor_type_0 = (
                    GetSessionsIdResponse200MessagesItemContentCursorType0.from_dict(
                        data
                    )
                )

                return content_cursor_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(
                GetSessionsIdResponse200MessagesItemContentCursorType0 | None, data
            )

        content_cursor = _parse_content_cursor(d.pop("content_cursor"))

        def _parse_tool_name(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        tool_name = _parse_tool_name(d.pop("tool_name"))

        def _parse_tool_use_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        tool_use_id = _parse_tool_use_id(d.pop("tool_use_id"))

        def _parse_model(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        model = _parse_model(d.pop("model"))

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

        received_at = datetime.datetime.fromisoformat(d.pop("received_at"))

        def _parse_input_tokens(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        input_tokens = _parse_input_tokens(d.pop("input_tokens"))

        def _parse_output_tokens(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        output_tokens = _parse_output_tokens(d.pop("output_tokens"))

        def _parse_agent_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        agent_id = _parse_agent_id(d.pop("agent_id"))

        truncated_fields = cast(list[str], d.pop("truncated_fields"))

        get_sessions_id_response_200_messages_item = cls(
            message_id=message_id,
            session_id=session_id,
            raw_record_id=raw_record_id,
            ingest_batch_id=ingest_batch_id,
            seq=seq,
            role=role,
            kind=kind,
            content=content,
            content_cursor=content_cursor,
            tool_name=tool_name,
            tool_use_id=tool_use_id,
            model=model,
            timestamp=timestamp,
            received_at=received_at,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            agent_id=agent_id,
            truncated_fields=truncated_fields,
        )

        return get_sessions_id_response_200_messages_item
