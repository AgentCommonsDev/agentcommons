from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define

from ..models.get_admin_tool_policy_violations_response_200_items_item_decision import (
    GetAdminToolPolicyViolationsResponse200ItemsItemDecision,
    check_get_admin_tool_policy_violations_response_200_items_item_decision,
)
from ..models.get_admin_tool_policy_violations_response_200_items_item_harness import (
    GetAdminToolPolicyViolationsResponse200ItemsItemHarness,
    check_get_admin_tool_policy_violations_response_200_items_item_harness,
)
from ..models.get_admin_tool_policy_violations_response_200_items_item_severity_type_0 import (
    GetAdminToolPolicyViolationsResponse200ItemsItemSeverityType0,
    check_get_admin_tool_policy_violations_response_200_items_item_severity_type_0,
)
from ..models.get_admin_tool_policy_violations_response_200_items_item_source import (
    GetAdminToolPolicyViolationsResponse200ItemsItemSource,
    check_get_admin_tool_policy_violations_response_200_items_item_source,
)

T = TypeVar("T", bound="GetAdminToolPolicyViolationsResponse200ItemsItem")


@_attrs_define
class GetAdminToolPolicyViolationsResponse200ItemsItem:
    """
    Attributes:
        id (UUID):
        session_id (UUID):
        source (GetAdminToolPolicyViolationsResponse200ItemsItemSource):
        seq (int | None):
        harness (GetAdminToolPolicyViolationsResponse200ItemsItemHarness):
        tool (str):
        rule_id (None | str):
        decision (GetAdminToolPolicyViolationsResponse200ItemsItemDecision):
        severity (GetAdminToolPolicyViolationsResponse200ItemsItemSeverityType0 | None):
        enforced (bool):
        masked_command (None | str):
        fingerprint (None | str):
        matched_at (datetime.datetime):
    """

    id: UUID
    session_id: UUID
    source: GetAdminToolPolicyViolationsResponse200ItemsItemSource
    seq: int | None
    harness: GetAdminToolPolicyViolationsResponse200ItemsItemHarness
    tool: str
    rule_id: None | str
    decision: GetAdminToolPolicyViolationsResponse200ItemsItemDecision
    severity: GetAdminToolPolicyViolationsResponse200ItemsItemSeverityType0 | None
    enforced: bool
    masked_command: None | str
    fingerprint: None | str
    matched_at: datetime.datetime

    def to_dict(self) -> dict[str, Any]:
        id = str(self.id)

        session_id = str(self.session_id)

        source: str = self.source

        seq: int | None
        seq = self.seq

        harness: str = self.harness

        tool = self.tool

        rule_id: None | str
        rule_id = self.rule_id

        decision: str = self.decision

        severity: None | str
        if isinstance(self.severity, str):
            severity = self.severity
        else:
            severity = self.severity

        enforced = self.enforced

        masked_command: None | str
        masked_command = self.masked_command

        fingerprint: None | str
        fingerprint = self.fingerprint

        matched_at = self.matched_at.isoformat()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "session_id": session_id,
                "source": source,
                "seq": seq,
                "harness": harness,
                "tool": tool,
                "rule_id": rule_id,
                "decision": decision,
                "severity": severity,
                "enforced": enforced,
                "masked_command": masked_command,
                "fingerprint": fingerprint,
                "matched_at": matched_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = UUID(d.pop("id"))

        session_id = UUID(d.pop("session_id"))

        source = check_get_admin_tool_policy_violations_response_200_items_item_source(
            d.pop("source")
        )

        def _parse_seq(data: object) -> int | None:
            if data is None:
                return data
            return cast(int | None, data)

        seq = _parse_seq(d.pop("seq"))

        harness = (
            check_get_admin_tool_policy_violations_response_200_items_item_harness(
                d.pop("harness")
            )
        )

        tool = d.pop("tool")

        def _parse_rule_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        rule_id = _parse_rule_id(d.pop("rule_id"))

        decision = (
            check_get_admin_tool_policy_violations_response_200_items_item_decision(
                d.pop("decision")
            )
        )

        def _parse_severity(
            data: object,
        ) -> GetAdminToolPolicyViolationsResponse200ItemsItemSeverityType0 | None:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                severity_type_0 = check_get_admin_tool_policy_violations_response_200_items_item_severity_type_0(
                    data
                )

                return severity_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(
                GetAdminToolPolicyViolationsResponse200ItemsItemSeverityType0 | None,
                data,
            )

        severity = _parse_severity(d.pop("severity"))

        enforced = d.pop("enforced")

        def _parse_masked_command(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        masked_command = _parse_masked_command(d.pop("masked_command"))

        def _parse_fingerprint(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        fingerprint = _parse_fingerprint(d.pop("fingerprint"))

        matched_at = datetime.datetime.fromisoformat(d.pop("matched_at"))

        get_admin_tool_policy_violations_response_200_items_item = cls(
            id=id,
            session_id=session_id,
            source=source,
            seq=seq,
            harness=harness,
            tool=tool,
            rule_id=rule_id,
            decision=decision,
            severity=severity,
            enforced=enforced,
            masked_command=masked_command,
            fingerprint=fingerprint,
            matched_at=matched_at,
        )

        return get_admin_tool_policy_violations_response_200_items_item
