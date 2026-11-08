from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar
from uuid import UUID

from attrs import define as _attrs_define

from ..models.get_admin_tool_policy_violations_filters_decision import (
    GetAdminToolPolicyViolationsFiltersDecision,
    check_get_admin_tool_policy_violations_filters_decision,
)
from ..models.get_admin_tool_policy_violations_filters_harness import (
    GetAdminToolPolicyViolationsFiltersHarness,
    check_get_admin_tool_policy_violations_filters_harness,
)
from ..models.get_admin_tool_policy_violations_filters_severity import (
    GetAdminToolPolicyViolationsFiltersSeverity,
    check_get_admin_tool_policy_violations_filters_severity,
)
from ..models.get_admin_tool_policy_violations_filters_source import (
    GetAdminToolPolicyViolationsFiltersSource,
    check_get_admin_tool_policy_violations_filters_source,
)
from ..types import UNSET, Unset

T = TypeVar("T", bound="GetAdminToolPolicyViolationsFilters")


@_attrs_define
class GetAdminToolPolicyViolationsFilters:
    """
    Attributes:
        session_id (UUID | Unset):
        source (GetAdminToolPolicyViolationsFiltersSource | Unset):
        harness (GetAdminToolPolicyViolationsFiltersHarness | Unset):
        rule_id (str | Unset):
        decision (GetAdminToolPolicyViolationsFiltersDecision | Unset):
        severity (GetAdminToolPolicyViolationsFiltersSeverity | Unset):
        enforced (bool | Unset):
    """

    session_id: UUID | Unset = UNSET
    source: GetAdminToolPolicyViolationsFiltersSource | Unset = UNSET
    harness: GetAdminToolPolicyViolationsFiltersHarness | Unset = UNSET
    rule_id: str | Unset = UNSET
    decision: GetAdminToolPolicyViolationsFiltersDecision | Unset = UNSET
    severity: GetAdminToolPolicyViolationsFiltersSeverity | Unset = UNSET
    enforced: bool | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        session_id: str | Unset = UNSET
        if not isinstance(self.session_id, Unset):
            session_id = str(self.session_id)

        source: str | Unset = UNSET
        if not isinstance(self.source, Unset):
            source = self.source

        harness: str | Unset = UNSET
        if not isinstance(self.harness, Unset):
            harness = self.harness

        rule_id = self.rule_id

        decision: str | Unset = UNSET
        if not isinstance(self.decision, Unset):
            decision = self.decision

        severity: str | Unset = UNSET
        if not isinstance(self.severity, Unset):
            severity = self.severity

        enforced = self.enforced

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if session_id is not UNSET:
            field_dict["session_id"] = session_id
        if source is not UNSET:
            field_dict["source"] = source
        if harness is not UNSET:
            field_dict["harness"] = harness
        if rule_id is not UNSET:
            field_dict["rule_id"] = rule_id
        if decision is not UNSET:
            field_dict["decision"] = decision
        if severity is not UNSET:
            field_dict["severity"] = severity
        if enforced is not UNSET:
            field_dict["enforced"] = enforced

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        _session_id = d.pop("session_id", UNSET)
        session_id: UUID | Unset
        if isinstance(_session_id, Unset):
            session_id = UNSET
        else:
            session_id = UUID(_session_id)

        _source = d.pop("source", UNSET)
        source: GetAdminToolPolicyViolationsFiltersSource | Unset
        if isinstance(_source, Unset):
            source = UNSET
        else:
            source = check_get_admin_tool_policy_violations_filters_source(_source)

        _harness = d.pop("harness", UNSET)
        harness: GetAdminToolPolicyViolationsFiltersHarness | Unset
        if isinstance(_harness, Unset):
            harness = UNSET
        else:
            harness = check_get_admin_tool_policy_violations_filters_harness(_harness)

        rule_id = d.pop("rule_id", UNSET)

        _decision = d.pop("decision", UNSET)
        decision: GetAdminToolPolicyViolationsFiltersDecision | Unset
        if isinstance(_decision, Unset):
            decision = UNSET
        else:
            decision = check_get_admin_tool_policy_violations_filters_decision(
                _decision
            )

        _severity = d.pop("severity", UNSET)
        severity: GetAdminToolPolicyViolationsFiltersSeverity | Unset
        if isinstance(_severity, Unset):
            severity = UNSET
        else:
            severity = check_get_admin_tool_policy_violations_filters_severity(
                _severity
            )

        enforced = d.pop("enforced", UNSET)

        get_admin_tool_policy_violations_filters = cls(
            session_id=session_id,
            source=source,
            harness=harness,
            rule_id=rule_id,
            decision=decision,
            severity=severity,
            enforced=enforced,
        )

        return get_admin_tool_policy_violations_filters
