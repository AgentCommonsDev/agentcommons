from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="PatchAdminRedactionPoliciesIdBodyType1Options")


@_attrs_define
class PatchAdminRedactionPoliciesIdBodyType1Options:
    """
    Attributes:
        allows (list[str] | Unset):
    """

    allows: list[str] | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        allows: list[str] | Unset = UNSET
        if not isinstance(self.allows, Unset):
            allows = self.allows

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if allows is not UNSET:
            field_dict["allows"] = allows

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        allows = cast(list[str], d.pop("allows", UNSET))

        patch_admin_redaction_policies_id_body_type_1_options = cls(
            allows=allows,
        )

        return patch_admin_redaction_policies_id_body_type_1_options
