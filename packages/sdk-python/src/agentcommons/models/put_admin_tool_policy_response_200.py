from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.put_admin_tool_policy_response_200_rules_item import (
        PutAdminToolPolicyResponse200RulesItem,
    )


T = TypeVar("T", bound="PutAdminToolPolicyResponse200")


@_attrs_define
class PutAdminToolPolicyResponse200:
    """
    Attributes:
        enabled (bool):
        rules (list[PutAdminToolPolicyResponse200RulesItem]):
        revision (int):
        updated_at (datetime.datetime):
    """

    enabled: bool
    rules: list[PutAdminToolPolicyResponse200RulesItem]
    revision: int
    updated_at: datetime.datetime

    def to_dict(self) -> dict[str, Any]:
        enabled = self.enabled

        rules = []
        for rules_item_data in self.rules:
            rules_item = rules_item_data.to_dict()
            rules.append(rules_item)

        revision = self.revision

        updated_at = self.updated_at.isoformat()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "enabled": enabled,
                "rules": rules,
                "revision": revision,
                "updated_at": updated_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.put_admin_tool_policy_response_200_rules_item import (
            PutAdminToolPolicyResponse200RulesItem,  # noqa: PLC0415
        )

        d = dict(src_dict)
        enabled = d.pop("enabled")

        rules = []
        _rules = d.pop("rules")
        for rules_item_data in _rules:
            rules_item = PutAdminToolPolicyResponse200RulesItem.from_dict(
                rules_item_data
            )

            rules.append(rules_item)

        revision = d.pop("revision")

        updated_at = datetime.datetime.fromisoformat(d.pop("updated_at"))

        put_admin_tool_policy_response_200 = cls(
            enabled=enabled,
            rules=rules,
            revision=revision,
            updated_at=updated_at,
        )

        return put_admin_tool_policy_response_200
