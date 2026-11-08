from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.get_tool_policy_response_200_rules_item_action import (
    GetToolPolicyResponse200RulesItemAction,
    check_get_tool_policy_response_200_rules_item_action,
)
from ..models.get_tool_policy_response_200_rules_item_harnesses_item import (
    GetToolPolicyResponse200RulesItemHarnessesItem,
    check_get_tool_policy_response_200_rules_item_harnesses_item,
)
from ..models.get_tool_policy_response_200_rules_item_severity import (
    GetToolPolicyResponse200RulesItemSeverity,
    check_get_tool_policy_response_200_rules_item_severity,
)
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.get_tool_policy_response_200_rules_item_command_patterns_item import (
        GetToolPolicyResponse200RulesItemCommandPatternsItem,
    )


T = TypeVar("T", bound="GetToolPolicyResponse200RulesItem")


@_attrs_define
class GetToolPolicyResponse200RulesItem:
    """
    Attributes:
        id (str):
        harnesses (list[GetToolPolicyResponse200RulesItemHarnessesItem]):
        tool (str):
        command_patterns (list[GetToolPolicyResponse200RulesItemCommandPatternsItem]):
        action (GetToolPolicyResponse200RulesItemAction):
        severity (GetToolPolicyResponse200RulesItemSeverity):
        description (str | Unset):
    """

    id: str
    harnesses: list[GetToolPolicyResponse200RulesItemHarnessesItem]
    tool: str
    command_patterns: list[GetToolPolicyResponse200RulesItemCommandPatternsItem]
    action: GetToolPolicyResponse200RulesItemAction
    severity: GetToolPolicyResponse200RulesItemSeverity
    description: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        harnesses = []
        for harnesses_item_data in self.harnesses:
            harnesses_item: str = harnesses_item_data
            harnesses.append(harnesses_item)

        tool = self.tool

        command_patterns = []
        for command_patterns_item_data in self.command_patterns:
            command_patterns_item = command_patterns_item_data.to_dict()
            command_patterns.append(command_patterns_item)

        action: str = self.action

        severity: str = self.severity

        description = self.description

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "harnesses": harnesses,
                "tool": tool,
                "command_patterns": command_patterns,
                "action": action,
                "severity": severity,
            }
        )
        if description is not UNSET:
            field_dict["description"] = description

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_tool_policy_response_200_rules_item_command_patterns_item import (
            GetToolPolicyResponse200RulesItemCommandPatternsItem,  # noqa: PLC0415
        )

        d = dict(src_dict)
        id = d.pop("id")

        harnesses = []
        _harnesses = d.pop("harnesses")
        for harnesses_item_data in _harnesses:
            harnesses_item = (
                check_get_tool_policy_response_200_rules_item_harnesses_item(
                    harnesses_item_data
                )
            )

            harnesses.append(harnesses_item)

        tool = d.pop("tool")

        command_patterns = []
        _command_patterns = d.pop("command_patterns")
        for command_patterns_item_data in _command_patterns:
            command_patterns_item = (
                GetToolPolicyResponse200RulesItemCommandPatternsItem.from_dict(
                    command_patterns_item_data
                )
            )

            command_patterns.append(command_patterns_item)

        action = check_get_tool_policy_response_200_rules_item_action(d.pop("action"))

        severity = check_get_tool_policy_response_200_rules_item_severity(
            d.pop("severity")
        )

        description = d.pop("description", UNSET)

        get_tool_policy_response_200_rules_item = cls(
            id=id,
            harnesses=harnesses,
            tool=tool,
            command_patterns=command_patterns,
            action=action,
            severity=severity,
            description=description,
        )

        return get_tool_policy_response_200_rules_item
