from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.get_tool_policy_response_200_rules_item_command_patterns_item_kind import (
    GetToolPolicyResponse200RulesItemCommandPatternsItemKind,
    check_get_tool_policy_response_200_rules_item_command_patterns_item_kind,
)

T = TypeVar("T", bound="GetToolPolicyResponse200RulesItemCommandPatternsItem")


@_attrs_define
class GetToolPolicyResponse200RulesItemCommandPatternsItem:
    """
    Attributes:
        kind (GetToolPolicyResponse200RulesItemCommandPatternsItemKind):
        value (str):
    """

    kind: GetToolPolicyResponse200RulesItemCommandPatternsItemKind
    value: str

    def to_dict(self) -> dict[str, Any]:
        kind: str = self.kind

        value = self.value

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "kind": kind,
                "value": value,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        kind = check_get_tool_policy_response_200_rules_item_command_patterns_item_kind(
            d.pop("kind")
        )

        value = d.pop("value")

        get_tool_policy_response_200_rules_item_command_patterns_item = cls(
            kind=kind,
            value=value,
        )

        return get_tool_policy_response_200_rules_item_command_patterns_item
