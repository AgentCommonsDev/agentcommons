from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.patch_admin_redaction_policies_id_body_type_1_kind import (
    PatchAdminRedactionPoliciesIdBodyType1Kind,
    check_patch_admin_redaction_policies_id_body_type_1_kind,
)
from ..models.patch_admin_redaction_policies_id_body_type_1_rule_id import (
    PatchAdminRedactionPoliciesIdBodyType1RuleId,
    check_patch_admin_redaction_policies_id_body_type_1_rule_id,
)
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.patch_admin_redaction_policies_id_body_type_1_options import (
        PatchAdminRedactionPoliciesIdBodyType1Options,
    )


T = TypeVar("T", bound="PatchAdminRedactionPoliciesIdBodyType1")


@_attrs_define
class PatchAdminRedactionPoliciesIdBodyType1:
    """
    Attributes:
        name (str):
        kind (PatchAdminRedactionPoliciesIdBodyType1Kind):
        rule_id (PatchAdminRedactionPoliciesIdBodyType1RuleId):
        replacement (str | Unset):
        enabled (bool | Unset):  Default: True.
        options (PatchAdminRedactionPoliciesIdBodyType1Options | Unset):
    """

    name: str
    kind: PatchAdminRedactionPoliciesIdBodyType1Kind
    rule_id: PatchAdminRedactionPoliciesIdBodyType1RuleId
    replacement: str | Unset = UNSET
    enabled: bool | Unset = True
    options: PatchAdminRedactionPoliciesIdBodyType1Options | Unset = UNSET

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
        from ..models.patch_admin_redaction_policies_id_body_type_1_options import (
            PatchAdminRedactionPoliciesIdBodyType1Options,  # noqa: PLC0415
        )

        d = dict(src_dict)
        name = d.pop("name")

        kind = check_patch_admin_redaction_policies_id_body_type_1_kind(d.pop("kind"))

        rule_id = check_patch_admin_redaction_policies_id_body_type_1_rule_id(
            d.pop("ruleId")
        )

        replacement = d.pop("replacement", UNSET)

        enabled = d.pop("enabled", UNSET)

        _options = d.pop("options", UNSET)
        options: PatchAdminRedactionPoliciesIdBodyType1Options | Unset
        if isinstance(_options, Unset):
            options = UNSET
        else:
            options = PatchAdminRedactionPoliciesIdBodyType1Options.from_dict(_options)

        patch_admin_redaction_policies_id_body_type_1 = cls(
            name=name,
            kind=kind,
            rule_id=rule_id,
            replacement=replacement,
            enabled=enabled,
            options=options,
        )

        return patch_admin_redaction_policies_id_body_type_1
