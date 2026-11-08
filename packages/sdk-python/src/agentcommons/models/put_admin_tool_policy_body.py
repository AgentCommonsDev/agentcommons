from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.put_admin_tool_policy_body_rules_item import (
        PutAdminToolPolicyBodyRulesItem,
    )


T = TypeVar("T", bound="PutAdminToolPolicyBody")


@_attrs_define
class PutAdminToolPolicyBody:
    """
    Attributes:
        enabled (bool | Unset):  Default: False.
        rules (list[PutAdminToolPolicyBodyRulesItem] | Unset):
    """

    enabled: bool | Unset = False
    rules: list[PutAdminToolPolicyBodyRulesItem] | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        enabled = self.enabled

        rules: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.rules, Unset):
            rules = []
            for rules_item_data in self.rules:
                rules_item = rules_item_data.to_dict()
                rules.append(rules_item)

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if enabled is not UNSET:
            field_dict["enabled"] = enabled
        if rules is not UNSET:
            field_dict["rules"] = rules

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.put_admin_tool_policy_body_rules_item import (
            PutAdminToolPolicyBodyRulesItem,  # noqa: PLC0415
        )

        d = dict(src_dict)
        enabled = d.pop("enabled", UNSET)

        _rules = d.pop("rules", UNSET)
        rules: list[PutAdminToolPolicyBodyRulesItem] | Unset = UNSET
        if _rules is not UNSET:
            rules = []
            for rules_item_data in _rules:
                rules_item = PutAdminToolPolicyBodyRulesItem.from_dict(rules_item_data)

                rules.append(rules_item)

        put_admin_tool_policy_body = cls(
            enabled=enabled,
            rules=rules,
        )

        return put_admin_tool_policy_body
