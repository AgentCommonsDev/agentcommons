from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="DeleteAdminRedactionPoliciesIdBody")


@_attrs_define
class DeleteAdminRedactionPoliciesIdBody:
    """
    Attributes:
        reason (str):
    """

    reason: str

    def to_dict(self) -> dict[str, Any]:
        reason = self.reason

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "reason": reason,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        reason = d.pop("reason")

        delete_admin_redaction_policies_id_body = cls(
            reason=reason,
        )

        return delete_admin_redaction_policies_id_body
