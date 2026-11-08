from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define

from ..models.post_admin_redaction_policies_response_200_kind import (
    PostAdminRedactionPoliciesResponse200Kind,
    check_post_admin_redaction_policies_response_200_kind,
)

T = TypeVar("T", bound="PostAdminRedactionPoliciesResponse200")


@_attrs_define
class PostAdminRedactionPoliciesResponse200:
    """
    Attributes:
        id (UUID):
        organization_id (str):
        name (str):
        kind (PostAdminRedactionPoliciesResponse200Kind):
        pattern (None | str):
        flags (None | str):
        rule_id (None | str):
        options (Any | None):
        replacement (str):
        enabled (bool):
        builtin (bool):
        created_by_user_id (None | str):
        created_at (datetime.datetime):
        updated_at (datetime.datetime):
    """

    id: UUID
    organization_id: str
    name: str
    kind: PostAdminRedactionPoliciesResponse200Kind
    pattern: None | str
    flags: None | str
    rule_id: None | str
    options: Any | None
    replacement: str
    enabled: bool
    builtin: bool
    created_by_user_id: None | str
    created_at: datetime.datetime
    updated_at: datetime.datetime

    def to_dict(self) -> dict[str, Any]:
        id = str(self.id)

        organization_id = self.organization_id

        name = self.name

        kind: str = self.kind

        pattern: None | str
        pattern = self.pattern

        flags: None | str
        flags = self.flags

        rule_id: None | str
        rule_id = self.rule_id

        options: Any | None
        options = self.options

        replacement = self.replacement

        enabled = self.enabled

        builtin = self.builtin

        created_by_user_id: None | str
        created_by_user_id = self.created_by_user_id

        created_at = self.created_at.isoformat()

        updated_at = self.updated_at.isoformat()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "organization_id": organization_id,
                "name": name,
                "kind": kind,
                "pattern": pattern,
                "flags": flags,
                "rule_id": rule_id,
                "options": options,
                "replacement": replacement,
                "enabled": enabled,
                "builtin": builtin,
                "created_by_user_id": created_by_user_id,
                "created_at": created_at,
                "updated_at": updated_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = UUID(d.pop("id"))

        organization_id = d.pop("organization_id")

        name = d.pop("name")

        kind = check_post_admin_redaction_policies_response_200_kind(d.pop("kind"))

        def _parse_pattern(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        pattern = _parse_pattern(d.pop("pattern"))

        def _parse_flags(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        flags = _parse_flags(d.pop("flags"))

        def _parse_rule_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        rule_id = _parse_rule_id(d.pop("rule_id"))

        def _parse_options(data: object) -> Any | None:
            if data is None:
                return data
            return cast(Any | None, data)

        options = _parse_options(d.pop("options"))

        replacement = d.pop("replacement")

        enabled = d.pop("enabled")

        builtin = d.pop("builtin")

        def _parse_created_by_user_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        created_by_user_id = _parse_created_by_user_id(d.pop("created_by_user_id"))

        created_at = datetime.datetime.fromisoformat(d.pop("created_at"))

        updated_at = datetime.datetime.fromisoformat(d.pop("updated_at"))

        post_admin_redaction_policies_response_200 = cls(
            id=id,
            organization_id=organization_id,
            name=name,
            kind=kind,
            pattern=pattern,
            flags=flags,
            rule_id=rule_id,
            options=options,
            replacement=replacement,
            enabled=enabled,
            builtin=builtin,
            created_by_user_id=created_by_user_id,
            created_at=created_at,
            updated_at=updated_at,
        )

        return post_admin_redaction_policies_response_200
