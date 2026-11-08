from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.post_tool_policy_violations_body_violations_item import (
        PostToolPolicyViolationsBodyViolationsItem,
    )


T = TypeVar("T", bound="PostToolPolicyViolationsBody")


@_attrs_define
class PostToolPolicyViolationsBody:
    """
    Attributes:
        violations (list[PostToolPolicyViolationsBodyViolationsItem]):
    """

    violations: list[PostToolPolicyViolationsBodyViolationsItem]

    def to_dict(self) -> dict[str, Any]:
        violations = []
        for violations_item_data in self.violations:
            violations_item = violations_item_data.to_dict()
            violations.append(violations_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "violations": violations,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_tool_policy_violations_body_violations_item import (
            PostToolPolicyViolationsBodyViolationsItem,  # noqa: PLC0415
        )

        d = dict(src_dict)
        violations = []
        _violations = d.pop("violations")
        for violations_item_data in _violations:
            violations_item = PostToolPolicyViolationsBodyViolationsItem.from_dict(
                violations_item_data
            )

            violations.append(violations_item)

        post_tool_policy_violations_body = cls(
            violations=violations,
        )

        return post_tool_policy_violations_body
