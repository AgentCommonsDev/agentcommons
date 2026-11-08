from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, TypeVar
from uuid import UUID

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="PostAdminRedactionRescanBody")


@_attrs_define
class PostAdminRedactionRescanBody:
    """
    Attributes:
        reason (str):
        policy_ids (list[UUID] | Unset):
        since (datetime.datetime | Unset):
    """

    reason: str
    policy_ids: list[UUID] | Unset = UNSET
    since: datetime.datetime | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        reason = self.reason

        policy_ids: list[str] | Unset = UNSET
        if not isinstance(self.policy_ids, Unset):
            policy_ids = []
            for policy_ids_item_data in self.policy_ids:
                policy_ids_item = str(policy_ids_item_data)
                policy_ids.append(policy_ids_item)

        since: str | Unset = UNSET
        if not isinstance(self.since, Unset):
            since = self.since.isoformat()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "reason": reason,
            }
        )
        if policy_ids is not UNSET:
            field_dict["policyIds"] = policy_ids
        if since is not UNSET:
            field_dict["since"] = since

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        reason = d.pop("reason")

        _policy_ids = d.pop("policyIds", UNSET)
        policy_ids: list[UUID] | Unset = UNSET
        if _policy_ids is not UNSET:
            policy_ids = []
            for policy_ids_item_data in _policy_ids:
                policy_ids_item = UUID(policy_ids_item_data)

                policy_ids.append(policy_ids_item)

        _since = d.pop("since", UNSET)
        since: datetime.datetime | Unset
        if isinstance(_since, Unset):
            since = UNSET
        else:
            since = datetime.datetime.fromisoformat(_since)

        post_admin_redaction_rescan_body = cls(
            reason=reason,
            policy_ids=policy_ids,
            since=since,
        )

        return post_admin_redaction_rescan_body
