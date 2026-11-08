from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define

from ..models.get_sessions_id_similar_response_200_sessions_item_children_item_parent_relation_type_0 import (
    GetSessionsIdSimilarResponse200SessionsItemChildrenItemParentRelationType0,
    check_get_sessions_id_similar_response_200_sessions_item_children_item_parent_relation_type_0,
)

T = TypeVar("T", bound="GetSessionsIdSimilarResponse200SessionsItemChildrenItem")


@_attrs_define
class GetSessionsIdSimilarResponse200SessionsItemChildrenItem:
    """
    Attributes:
        session_id (UUID): Related session; pass to get
        title (None | str): Short title derived from the session
        parent_relation (GetSessionsIdSimilarResponse200SessionsItemChildrenItemParentRelationType0 | None): SUBAGENT,
            FORK or SPAWNED
        parent_tool_use_id (None | str): Parent tool_use_id of the call that spawned this child; NULL when unrecorded
        agent_type (None | str): Subagent type when the session is a subagent
    """

    session_id: UUID
    title: None | str
    parent_relation: (
        GetSessionsIdSimilarResponse200SessionsItemChildrenItemParentRelationType0
        | None
    )
    parent_tool_use_id: None | str
    agent_type: None | str

    def to_dict(self) -> dict[str, Any]:
        session_id = str(self.session_id)

        title: None | str
        title = self.title

        parent_relation: None | str
        if isinstance(self.parent_relation, str):
            parent_relation = self.parent_relation
        else:
            parent_relation = self.parent_relation

        parent_tool_use_id: None | str
        parent_tool_use_id = self.parent_tool_use_id

        agent_type: None | str
        agent_type = self.agent_type

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "session_id": session_id,
                "title": title,
                "parent_relation": parent_relation,
                "parent_tool_use_id": parent_tool_use_id,
                "agent_type": agent_type,
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

        def _parse_parent_relation(
            data: object,
        ) -> (
            GetSessionsIdSimilarResponse200SessionsItemChildrenItemParentRelationType0
            | None
        ):
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                parent_relation_type_0 = check_get_sessions_id_similar_response_200_sessions_item_children_item_parent_relation_type_0(
                    data
                )

                return parent_relation_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(
                GetSessionsIdSimilarResponse200SessionsItemChildrenItemParentRelationType0
                | None,
                data,
            )

        parent_relation = _parse_parent_relation(d.pop("parent_relation"))

        def _parse_parent_tool_use_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        parent_tool_use_id = _parse_parent_tool_use_id(d.pop("parent_tool_use_id"))

        def _parse_agent_type(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        agent_type = _parse_agent_type(d.pop("agent_type"))

        get_sessions_id_similar_response_200_sessions_item_children_item = cls(
            session_id=session_id,
            title=title,
            parent_relation=parent_relation,
            parent_tool_use_id=parent_tool_use_id,
            agent_type=agent_type,
        )

        return get_sessions_id_similar_response_200_sessions_item_children_item
