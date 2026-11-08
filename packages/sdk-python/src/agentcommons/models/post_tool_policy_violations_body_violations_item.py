from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define

from ..models.post_tool_policy_violations_body_violations_item_decision import (
    PostToolPolicyViolationsBodyViolationsItemDecision,
    check_post_tool_policy_violations_body_violations_item_decision,
)
from ..models.post_tool_policy_violations_body_violations_item_harness import (
    PostToolPolicyViolationsBodyViolationsItemHarness,
    check_post_tool_policy_violations_body_violations_item_harness,
)
from ..models.post_tool_policy_violations_body_violations_item_severity import (
    PostToolPolicyViolationsBodyViolationsItemSeverity,
    check_post_tool_policy_violations_body_violations_item_severity,
)
from ..types import UNSET, Unset

T = TypeVar("T", bound="PostToolPolicyViolationsBodyViolationsItem")


@_attrs_define
class PostToolPolicyViolationsBodyViolationsItem:
    """
    Attributes:
        session_id (UUID):
        harness (PostToolPolicyViolationsBodyViolationsItemHarness):
        tool (str):
        rule_id (str):
        decision (PostToolPolicyViolationsBodyViolationsItemDecision):
        severity (PostToolPolicyViolationsBodyViolationsItemSeverity):
        matched_at (datetime.datetime):
        id (UUID | Unset):
        command (None | str | Unset):
        seq (int | None | Unset):
    """

    session_id: UUID
    harness: PostToolPolicyViolationsBodyViolationsItemHarness
    tool: str
    rule_id: str
    decision: PostToolPolicyViolationsBodyViolationsItemDecision
    severity: PostToolPolicyViolationsBodyViolationsItemSeverity
    matched_at: datetime.datetime
    id: UUID | Unset = UNSET
    command: None | str | Unset = UNSET
    seq: int | None | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        session_id = str(self.session_id)

        harness: str = self.harness

        tool = self.tool

        rule_id = self.rule_id

        decision: str = self.decision

        severity: str = self.severity

        matched_at = self.matched_at.isoformat()

        id: str | Unset = UNSET
        if not isinstance(self.id, Unset):
            id = str(self.id)

        command: None | str | Unset
        if isinstance(self.command, Unset):
            command = UNSET
        else:
            command = self.command

        seq: int | None | Unset
        if isinstance(self.seq, Unset):
            seq = UNSET
        else:
            seq = self.seq

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "session_id": session_id,
                "harness": harness,
                "tool": tool,
                "rule_id": rule_id,
                "decision": decision,
                "severity": severity,
                "matched_at": matched_at,
            }
        )
        if id is not UNSET:
            field_dict["id"] = id
        if command is not UNSET:
            field_dict["command"] = command
        if seq is not UNSET:
            field_dict["seq"] = seq

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        session_id = UUID(d.pop("session_id"))

        harness = check_post_tool_policy_violations_body_violations_item_harness(
            d.pop("harness")
        )

        tool = d.pop("tool")

        rule_id = d.pop("rule_id")

        decision = check_post_tool_policy_violations_body_violations_item_decision(
            d.pop("decision")
        )

        severity = check_post_tool_policy_violations_body_violations_item_severity(
            d.pop("severity")
        )

        matched_at = datetime.datetime.fromisoformat(d.pop("matched_at"))

        _id = d.pop("id", UNSET)
        id: UUID | Unset
        if isinstance(_id, Unset):
            id = UNSET
        else:
            id = UUID(_id)

        def _parse_command(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        command = _parse_command(d.pop("command", UNSET))

        def _parse_seq(data: object) -> int | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(int | None | Unset, data)

        seq = _parse_seq(d.pop("seq", UNSET))

        post_tool_policy_violations_body_violations_item = cls(
            session_id=session_id,
            harness=harness,
            tool=tool,
            rule_id=rule_id,
            decision=decision,
            severity=severity,
            matched_at=matched_at,
            id=id,
            command=command,
            seq=seq,
        )

        return post_tool_policy_violations_body_violations_item
