from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.put_admin_tool_policy_body_rules_item_action import (
    PutAdminToolPolicyBodyRulesItemAction,
    check_put_admin_tool_policy_body_rules_item_action,
)
from ..models.put_admin_tool_policy_body_rules_item_harnesses_item import (
    PutAdminToolPolicyBodyRulesItemHarnessesItem,
    check_put_admin_tool_policy_body_rules_item_harnesses_item,
)
from ..models.put_admin_tool_policy_body_rules_item_severity import (
    PutAdminToolPolicyBodyRulesItemSeverity,
    check_put_admin_tool_policy_body_rules_item_severity,
)
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.put_admin_tool_policy_body_rules_item_command_patterns_item import (
        PutAdminToolPolicyBodyRulesItemCommandPatternsItem,
    )


T = TypeVar("T", bound="PutAdminToolPolicyBodyRulesItem")


@_attrs_define
class PutAdminToolPolicyBodyRulesItem:
    """
    Attributes:
        id (str):
        tool (str):
        action (PutAdminToolPolicyBodyRulesItemAction):
        severity (PutAdminToolPolicyBodyRulesItemSeverity):
        description (str | Unset):
        harnesses (list[PutAdminToolPolicyBodyRulesItemHarnessesItem] | Unset):
        command_patterns (list[PutAdminToolPolicyBodyRulesItemCommandPatternsItem] | Unset):
    """

    id: str
    tool: str
    action: PutAdminToolPolicyBodyRulesItemAction
    severity: PutAdminToolPolicyBodyRulesItemSeverity
    description: str | Unset = UNSET
    harnesses: list[PutAdminToolPolicyBodyRulesItemHarnessesItem] | Unset = UNSET
    command_patterns: (
        list[PutAdminToolPolicyBodyRulesItemCommandPatternsItem] | Unset
    ) = UNSET

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        tool = self.tool

        action: str = self.action

        severity: str = self.severity

        description = self.description

        harnesses: list[str] | Unset = UNSET
        if not isinstance(self.harnesses, Unset):
            harnesses = []
            for harnesses_item_data in self.harnesses:
                harnesses_item: str = harnesses_item_data
                harnesses.append(harnesses_item)

        command_patterns: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.command_patterns, Unset):
            command_patterns = []
            for command_patterns_item_data in self.command_patterns:
                command_patterns_item = command_patterns_item_data.to_dict()
                command_patterns.append(command_patterns_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "tool": tool,
                "action": action,
                "severity": severity,
            }
        )
        if description is not UNSET:
            field_dict["description"] = description
        if harnesses is not UNSET:
            field_dict["harnesses"] = harnesses
        if command_patterns is not UNSET:
            field_dict["command_patterns"] = command_patterns

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.put_admin_tool_policy_body_rules_item_command_patterns_item import (
            PutAdminToolPolicyBodyRulesItemCommandPatternsItem,  # noqa: PLC0415
        )

        d = dict(src_dict)
        id = d.pop("id")

        tool = d.pop("tool")

        action = check_put_admin_tool_policy_body_rules_item_action(d.pop("action"))

        severity = check_put_admin_tool_policy_body_rules_item_severity(
            d.pop("severity")
        )

        description = d.pop("description", UNSET)

        _harnesses = d.pop("harnesses", UNSET)
        harnesses: list[PutAdminToolPolicyBodyRulesItemHarnessesItem] | Unset = UNSET
        if _harnesses is not UNSET:
            harnesses = []
            for harnesses_item_data in _harnesses:
                harnesses_item = (
                    check_put_admin_tool_policy_body_rules_item_harnesses_item(
                        harnesses_item_data
                    )
                )

                harnesses.append(harnesses_item)

        _command_patterns = d.pop("command_patterns", UNSET)
        command_patterns: (
            list[PutAdminToolPolicyBodyRulesItemCommandPatternsItem] | Unset
        ) = UNSET
        if _command_patterns is not UNSET:
            command_patterns = []
            for command_patterns_item_data in _command_patterns:
                command_patterns_item = (
                    PutAdminToolPolicyBodyRulesItemCommandPatternsItem.from_dict(
                        command_patterns_item_data
                    )
                )

                command_patterns.append(command_patterns_item)

        put_admin_tool_policy_body_rules_item = cls(
            id=id,
            tool=tool,
            action=action,
            severity=severity,
            description=description,
            harnesses=harnesses,
            command_patterns=command_patterns,
        )

        return put_admin_tool_policy_body_rules_item
