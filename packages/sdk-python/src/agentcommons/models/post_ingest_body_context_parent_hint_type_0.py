from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.post_ingest_body_context_parent_hint_type_0_relation import (
    PostIngestBodyContextParentHintType0Relation,
    check_post_ingest_body_context_parent_hint_type_0_relation,
)
from ..types import UNSET, Unset

T = TypeVar("T", bound="PostIngestBodyContextParentHintType0")


@_attrs_define
class PostIngestBodyContextParentHintType0:
    """
    Attributes:
        harness_session_id (str):
        relation (PostIngestBodyContextParentHintType0Relation):
        agent_id (str | Unset):
        agent_type (str | Unset):
    """

    harness_session_id: str
    relation: PostIngestBodyContextParentHintType0Relation
    agent_id: str | Unset = UNSET
    agent_type: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        harness_session_id = self.harness_session_id

        relation: str = self.relation

        agent_id = self.agent_id

        agent_type = self.agent_type

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "harnessSessionId": harness_session_id,
                "relation": relation,
            }
        )
        if agent_id is not UNSET:
            field_dict["agentId"] = agent_id
        if agent_type is not UNSET:
            field_dict["agentType"] = agent_type

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        harness_session_id = d.pop("harnessSessionId")

        relation = check_post_ingest_body_context_parent_hint_type_0_relation(
            d.pop("relation")
        )

        agent_id = d.pop("agentId", UNSET)

        agent_type = d.pop("agentType", UNSET)

        post_ingest_body_context_parent_hint_type_0 = cls(
            harness_session_id=harness_session_id,
            relation=relation,
            agent_id=agent_id,
            agent_type=agent_type,
        )

        return post_ingest_body_context_parent_hint_type_0
