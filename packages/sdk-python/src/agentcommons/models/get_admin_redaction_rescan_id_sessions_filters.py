from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="GetAdminRedactionRescanIdSessionsFilters")


@_attrs_define
class GetAdminRedactionRescanIdSessionsFilters:
    """
    Attributes:
        changed (bool | Unset):  Default: True.
    """

    changed: bool | Unset = True

    def to_dict(self) -> dict[str, Any]:
        changed = self.changed

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if changed is not UNSET:
            field_dict["changed"] = changed

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        changed = d.pop("changed", UNSET)

        get_admin_redaction_rescan_id_sessions_filters = cls(
            changed=changed,
        )

        return get_admin_redaction_rescan_id_sessions_filters
