from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar
from uuid import UUID

from attrs import define as _attrs_define

from ..models.get_admin_redaction_summary_response_200_by_policy_item_kind import (
    GetAdminRedactionSummaryResponse200ByPolicyItemKind,
    check_get_admin_redaction_summary_response_200_by_policy_item_kind,
)

T = TypeVar("T", bound="GetAdminRedactionSummaryResponse200ByPolicyItem")


@_attrs_define
class GetAdminRedactionSummaryResponse200ByPolicyItem:
    """
    Attributes:
        policy_id (UUID):
        name (str):
        kind (GetAdminRedactionSummaryResponse200ByPolicyItemKind):
        enabled (bool):
        count (int):
        sessions (int):
        distinct_secrets (int):
    """

    policy_id: UUID
    name: str
    kind: GetAdminRedactionSummaryResponse200ByPolicyItemKind
    enabled: bool
    count: int
    sessions: int
    distinct_secrets: int

    def to_dict(self) -> dict[str, Any]:
        policy_id = str(self.policy_id)

        name = self.name

        kind: str = self.kind

        enabled = self.enabled

        count = self.count

        sessions = self.sessions

        distinct_secrets = self.distinct_secrets

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "policy_id": policy_id,
                "name": name,
                "kind": kind,
                "enabled": enabled,
                "count": count,
                "sessions": sessions,
                "distinct_secrets": distinct_secrets,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        policy_id = UUID(d.pop("policy_id"))

        name = d.pop("name")

        kind = check_get_admin_redaction_summary_response_200_by_policy_item_kind(
            d.pop("kind")
        )

        enabled = d.pop("enabled")

        count = d.pop("count")

        sessions = d.pop("sessions")

        distinct_secrets = d.pop("distinct_secrets")

        get_admin_redaction_summary_response_200_by_policy_item = cls(
            policy_id=policy_id,
            name=name,
            kind=kind,
            enabled=enabled,
            count=count,
            sessions=sessions,
            distinct_secrets=distinct_secrets,
        )

        return get_admin_redaction_summary_response_200_by_policy_item
