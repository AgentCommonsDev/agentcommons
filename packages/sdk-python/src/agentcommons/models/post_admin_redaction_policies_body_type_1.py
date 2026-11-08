from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.post_admin_redaction_policies_body_type_1_kind import (
    PostAdminRedactionPoliciesBodyType1Kind,
    check_post_admin_redaction_policies_body_type_1_kind,
)
from ..models.post_admin_redaction_policies_body_type_1_rule_id import (
    PostAdminRedactionPoliciesBodyType1RuleId,
    check_post_admin_redaction_policies_body_type_1_rule_id,
)
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_admin_redaction_policies_body_type_1_options import (
        PostAdminRedactionPoliciesBodyType1Options,
    )


T = TypeVar("T", bound="PostAdminRedactionPoliciesBodyType1")


@_attrs_define
class PostAdminRedactionPoliciesBodyType1:
    """
    Attributes:
        name (str):
        kind (PostAdminRedactionPoliciesBodyType1Kind):
        rule_id (PostAdminRedactionPoliciesBodyType1RuleId):
        replacement (str | Unset):
        enabled (bool | Unset):  Default: True.
        options (PostAdminRedactionPoliciesBodyType1Options | Unset):
    """

    name: str
    kind: PostAdminRedactionPoliciesBodyType1Kind
    rule_id: PostAdminRedactionPoliciesBodyType1RuleId
    replacement: str | Unset = UNSET
    enabled: bool | Unset = True
    options: PostAdminRedactionPoliciesBodyType1Options | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        kind: str = self.kind

        rule_id: str = self.rule_id

        replacement = self.replacement

        enabled = self.enabled

        options: dict[str, Any] | Unset = UNSET
        if not isinstance(self.options, Unset):
            options = self.options.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "name": name,
                "kind": kind,
                "ruleId": rule_id,
            }
        )
        if replacement is not UNSET:
            field_dict["replacement"] = replacement
        if enabled is not UNSET:
            field_dict["enabled"] = enabled
        if options is not UNSET:
            field_dict["options"] = options

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_admin_redaction_policies_body_type_1_options import (
            PostAdminRedactionPoliciesBodyType1Options,  # noqa: PLC0415
        )

        d = dict(src_dict)
        name = d.pop("name")

        kind = check_post_admin_redaction_policies_body_type_1_kind(d.pop("kind"))

        rule_id = check_post_admin_redaction_policies_body_type_1_rule_id(
            d.pop("ruleId")
        )

        replacement = d.pop("replacement", UNSET)

        enabled = d.pop("enabled", UNSET)

        _options = d.pop("options", UNSET)
        options: PostAdminRedactionPoliciesBodyType1Options | Unset
        if isinstance(_options, Unset):
            options = UNSET
        else:
            options = PostAdminRedactionPoliciesBodyType1Options.from_dict(_options)

        post_admin_redaction_policies_body_type_1 = cls(
            name=name,
            kind=kind,
            rule_id=rule_id,
            replacement=replacement,
            enabled=enabled,
            options=options,
        )

        return post_admin_redaction_policies_body_type_1
