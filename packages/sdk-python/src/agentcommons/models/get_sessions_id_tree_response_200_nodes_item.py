from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define

from ..models.get_sessions_id_tree_response_200_nodes_item_harness import (
    GetSessionsIdTreeResponse200NodesItemHarness,
    check_get_sessions_id_tree_response_200_nodes_item_harness,
)
from ..models.get_sessions_id_tree_response_200_nodes_item_parent_relation_type_0 import (
    GetSessionsIdTreeResponse200NodesItemParentRelationType0,
    check_get_sessions_id_tree_response_200_nodes_item_parent_relation_type_0,
)
from ..models.get_sessions_id_tree_response_200_nodes_item_status import (
    GetSessionsIdTreeResponse200NodesItemStatus,
    check_get_sessions_id_tree_response_200_nodes_item_status,
)

T = TypeVar("T", bound="GetSessionsIdTreeResponse200NodesItem")


@_attrs_define
class GetSessionsIdTreeResponse200NodesItem:
    """
    Attributes:
        session_id (UUID): Primary key; every other view joins on it
        title (None | str): Short title derived from the session
        harness (GetSessionsIdTreeResponse200NodesItemHarness): Agent product: CLAUDE_CODE, CODEX, GEMINI_CLI or PI
        agent_type (None | str): Subagent type when the session is a subagent
        parent_relation (GetSessionsIdTreeResponse200NodesItemParentRelationType0 | None): SUBAGENT, FORK or SPAWNED
        parent_session_id (None | UUID): Parent session of a subagent, fork or spawned session
        parent_tool_use_id (None | str): Parent tool_use_id of the call that spawned this child; NULL when unrecorded
        user_email (str): Email of the member who ran it
        started_at (datetime.datetime): When the session started (UTC)
        status (GetSessionsIdTreeResponse200NodesItemStatus): ACTIVE, ENDED or INACTIVE
        message_count (int): Rows in messages for this session
        gap (bool):
        truncated_fields (list[str]): Fields shortened to fit the response
    """

    session_id: UUID
    title: None | str
    harness: GetSessionsIdTreeResponse200NodesItemHarness
    agent_type: None | str
    parent_relation: GetSessionsIdTreeResponse200NodesItemParentRelationType0 | None
    parent_session_id: None | UUID
    parent_tool_use_id: None | str
    user_email: str
    started_at: datetime.datetime
    status: GetSessionsIdTreeResponse200NodesItemStatus
    message_count: int
    gap: bool
    truncated_fields: list[str]

    def to_dict(self) -> dict[str, Any]:
        session_id = str(self.session_id)

        title: None | str
        title = self.title

        harness: str = self.harness

        agent_type: None | str
        agent_type = self.agent_type

        parent_relation: None | str
        if isinstance(self.parent_relation, str):
            parent_relation = self.parent_relation
        else:
            parent_relation = self.parent_relation

        parent_session_id: None | str
        if isinstance(self.parent_session_id, UUID):
            parent_session_id = str(self.parent_session_id)
        else:
            parent_session_id = self.parent_session_id

        parent_tool_use_id: None | str
        parent_tool_use_id = self.parent_tool_use_id

        user_email = self.user_email

        started_at = self.started_at.isoformat()

        status: str = self.status

        message_count = self.message_count

        gap = self.gap

        truncated_fields = self.truncated_fields

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "session_id": session_id,
                "title": title,
                "harness": harness,
                "agent_type": agent_type,
                "parent_relation": parent_relation,
                "parent_session_id": parent_session_id,
                "parent_tool_use_id": parent_tool_use_id,
                "user_email": user_email,
                "started_at": started_at,
                "status": status,
                "message_count": message_count,
                "gap": gap,
                "truncated_fields": truncated_fields,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        session_id = UUID(d.pop("session_id"))

        def _parse_title(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        title = _parse_title(d.pop("title"))

        harness = check_get_sessions_id_tree_response_200_nodes_item_harness(
            d.pop("harness")
        )

        def _parse_agent_type(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        agent_type = _parse_agent_type(d.pop("agent_type"))

        def _parse_parent_relation(
            data: object,
        ) -> GetSessionsIdTreeResponse200NodesItemParentRelationType0 | None:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                parent_relation_type_0 = check_get_sessions_id_tree_response_200_nodes_item_parent_relation_type_0(
                    data
                )

                return parent_relation_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(
                GetSessionsIdTreeResponse200NodesItemParentRelationType0 | None, data
            )

        parent_relation = _parse_parent_relation(d.pop("parent_relation"))

        def _parse_parent_session_id(data: object) -> None | UUID:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                parent_session_id_type_0 = UUID(data)

                return parent_session_id_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | UUID, data)

        parent_session_id = _parse_parent_session_id(d.pop("parent_session_id"))

        def _parse_parent_tool_use_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        parent_tool_use_id = _parse_parent_tool_use_id(d.pop("parent_tool_use_id"))

        user_email = d.pop("user_email")

        started_at = datetime.datetime.fromisoformat(d.pop("started_at"))

        status = check_get_sessions_id_tree_response_200_nodes_item_status(
            d.pop("status")
        )

        message_count = d.pop("message_count")

        gap = d.pop("gap")

        truncated_fields = cast(list[str], d.pop("truncated_fields"))

        get_sessions_id_tree_response_200_nodes_item = cls(
            session_id=session_id,
            title=title,
            harness=harness,
            agent_type=agent_type,
            parent_relation=parent_relation,
            parent_session_id=parent_session_id,
            parent_tool_use_id=parent_tool_use_id,
            user_email=user_email,
            started_at=started_at,
            status=status,
            message_count=message_count,
            gap=gap,
            truncated_fields=truncated_fields,
        )

        return get_sessions_id_tree_response_200_nodes_item
