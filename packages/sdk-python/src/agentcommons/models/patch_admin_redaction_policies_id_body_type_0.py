from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.patch_admin_redaction_policies_id_body_type_0_kind import (
    PatchAdminRedactionPoliciesIdBodyType0Kind,
    check_patch_admin_redaction_policies_id_body_type_0_kind,
)
from ..types import UNSET, Unset

T = TypeVar("T", bound="PatchAdminRedactionPoliciesIdBodyType0")


@_attrs_define
class PatchAdminRedactionPoliciesIdBodyType0:
    """
    Attributes:
        name (str):
        kind (PatchAdminRedactionPoliciesIdBodyType0Kind):
        pattern (str):
        replacement (str | Unset):
        enabled (bool | Unset):  Default: True.
        flags (str | Unset):  Default: 'g'.
    """

    name: str
    kind: PatchAdminRedactionPoliciesIdBodyType0Kind
    pattern: str
    replacement: str | Unset = UNSET
    enabled: bool | Unset = True
    flags: str | Unset = "g"

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        kind: str = self.kind

        pattern = self.pattern

        replacement = self.replacement

        enabled = self.enabled

        flags = self.flags

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "name": name,
                "kind": kind,
                "pattern": pattern,
            }
        )
        if replacement is not UNSET:
            field_dict["replacement"] = replacement
        if enabled is not UNSET:
            field_dict["enabled"] = enabled
        if flags is not UNSET:
            field_dict["flags"] = flags

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        name = d.pop("name")

        kind = check_patch_admin_redaction_policies_id_body_type_0_kind(d.pop("kind"))

        pattern = d.pop("pattern")

        replacement = d.pop("replacement", UNSET)

        enabled = d.pop("enabled", UNSET)

        flags = d.pop("flags", UNSET)

        patch_admin_redaction_policies_id_body_type_0 = cls(
            name=name,
            kind=kind,
            pattern=pattern,
            replacement=replacement,
            enabled=enabled,
            flags=flags,
        )

        return patch_admin_redaction_policies_id_body_type_0
