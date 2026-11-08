from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.put_admin_tool_policy_response_200_rules_item_command_patterns_item_kind import (
    PutAdminToolPolicyResponse200RulesItemCommandPatternsItemKind,
    check_put_admin_tool_policy_response_200_rules_item_command_patterns_item_kind,
)

T = TypeVar("T", bound="PutAdminToolPolicyResponse200RulesItemCommandPatternsItem")


@_attrs_define
class PutAdminToolPolicyResponse200RulesItemCommandPatternsItem:
    """
    Attributes:
        kind (PutAdminToolPolicyResponse200RulesItemCommandPatternsItemKind):
        value (str):
    """

    kind: PutAdminToolPolicyResponse200RulesItemCommandPatternsItemKind
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
        kind = check_put_admin_tool_policy_response_200_rules_item_command_patterns_item_kind(
            d.pop("kind")
        )

        value = d.pop("value")

        put_admin_tool_policy_response_200_rules_item_command_patterns_item = cls(
            kind=kind,
            value=value,
        )

        return put_admin_tool_policy_response_200_rules_item_command_patterns_item
