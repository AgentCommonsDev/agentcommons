from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.get_admin_redaction_policies_filters_kind import (
    GetAdminRedactionPoliciesFiltersKind,
    check_get_admin_redaction_policies_filters_kind,
)
from ..types import UNSET, Unset

T = TypeVar("T", bound="GetAdminRedactionPoliciesFilters")


@_attrs_define
class GetAdminRedactionPoliciesFilters:
    """
    Attributes:
        name (str | Unset):
        kind (GetAdminRedactionPoliciesFiltersKind | Unset):
        enabled (bool | Unset):
        builtin (bool | Unset):
    """

    name: str | Unset = UNSET
    kind: GetAdminRedactionPoliciesFiltersKind | Unset = UNSET
    enabled: bool | Unset = UNSET
    builtin: bool | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        kind: str | Unset = UNSET
        if not isinstance(self.kind, Unset):
            kind = self.kind

        enabled = self.enabled

        builtin = self.builtin

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if name is not UNSET:
            field_dict["name"] = name
        if kind is not UNSET:
            field_dict["kind"] = kind
        if enabled is not UNSET:
            field_dict["enabled"] = enabled
        if builtin is not UNSET:
            field_dict["builtin"] = builtin

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        name = d.pop("name", UNSET)

        _kind = d.pop("kind", UNSET)
        kind: GetAdminRedactionPoliciesFiltersKind | Unset
        if isinstance(_kind, Unset):
            kind = UNSET
        else:
            kind = check_get_admin_redaction_policies_filters_kind(_kind)

        enabled = d.pop("enabled", UNSET)

        builtin = d.pop("builtin", UNSET)

        get_admin_redaction_policies_filters = cls(
            name=name,
            kind=kind,
            enabled=enabled,
            builtin=builtin,
        )

        return get_admin_redaction_policies_filters
